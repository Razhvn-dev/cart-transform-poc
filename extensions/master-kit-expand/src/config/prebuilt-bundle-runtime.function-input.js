import { parseJsonObjectMetafield } from "./bundle-runtime.extraction.js";
import { clonePrebuiltBundleRuntimeValue } from "./prebuilt-bundle-runtime.clone.js";

/**
 * Normalizes only server-returned product metafields for the dev-only
 * pre-built candidate Function query.
 */
export function extractPrebuiltBundleRuntimeFunctionInput(input) {
  const accepted = new Map();
  const observations = [];

  for (const line of input?.cart?.lines ?? []) {
    const cartLineId = typeof line?.id === "string" ? line.id : null;
    const variant = line?.merchandise;
    if (variant?.__typename !== "ProductVariant" || typeof variant.id !== "string") continue;

    const product = variant.product;
    const mapping = parseJsonObjectMetafield(product?.prebuiltRuntimeMappingMetafield);
    const snapshot = parseJsonObjectMetafield(product?.prebuiltRuntimeSnapshotMetafield);
    const rejection = validateServerInput({ variant, mapping, snapshot });
    if (rejection) {
      observations.push({ cart_line_id: cartLineId, status: "rejected", reason: rejection });
      continue;
    }

    const prior = accepted.get(variant.id);
    if (prior && !sameServerInput(prior, { mapping, snapshot })) {
      observations.push({ cart_line_id: cartLineId, status: "rejected", reason: "CONFLICTING_SERVER_METAFIELDS" });
      prior.conflicted = true;
      continue;
    }
    accepted.set(variant.id, { mapping, snapshot, conflicted: false });
    observations.push({ cart_line_id: cartLineId, status: "accepted", reason: null });
  }

  const entries = [];
  const snapshotsByDefinitionId = {};
  accepted.forEach(({ mapping, snapshot, conflicted }) => {
    if (conflicted) return;
    entries.push(clonePrebuiltBundleRuntimeValue(mapping));
    snapshotsByDefinitionId[mapping.bundle_definition_id] = clonePrebuiltBundleRuntimeValue(snapshot);
  });
  entries.sort((left, right) => left.parent_variant_gid.localeCompare(right.parent_variant_gid));

  return deepFreeze({
    entries,
    snapshots_by_definition_id: snapshotsByDefinitionId,
    observations,
  });
}

function validateServerInput({ variant, mapping, snapshot }) {
  if (!isPlainObject(mapping)) return "MAPPING_METAFIELD_INVALID";
  if (!isPlainObject(snapshot)) return "SNAPSHOT_METAFIELD_INVALID";
  if (mapping.parent_variant_gid !== variant.id) return "MAPPING_PARENT_VARIANT_MISMATCH";
  if (snapshot?.parent?.variant_gid !== variant.id) return "SNAPSHOT_PARENT_VARIANT_MISMATCH";
  if (snapshot?.parent?.product_gid !== variant.product?.id) return "SNAPSHOT_PARENT_PRODUCT_MISMATCH";
  if (mapping.bundle_definition_id !== snapshot.configuration_id) return "SNAPSHOT_CONFIGURATION_MISMATCH";
  if (mapping.snapshot_checksum !== snapshot.checksum) return "SNAPSHOT_CHECKSUM_MISMATCH";
  return null;
}

function sameServerInput(left, right) {
  return JSON.stringify(left.mapping) === JSON.stringify(right.mapping)
    && JSON.stringify(left.snapshot) === JSON.stringify(right.snapshot);
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.keys(value).forEach((key) => deepFreeze(value[key]));
  return Object.freeze(value);
}
