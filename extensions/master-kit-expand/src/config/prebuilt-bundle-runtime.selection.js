import { PRODUCT_VARIANT_GID_REGEX, UUID_REGEX } from "./bundle-config.schema.js";
import { resolveValidatedRuntimeBundleSelection } from "./bundle-runtime.resolver-core.js";
import { clonePrebuiltBundleRuntimeValue } from "./prebuilt-bundle-runtime.clone.js";
import { validatePrebuiltRuntimeSnapshotForFunction } from "./prebuilt-bundle-runtime.snapshot-validation.js";

export const PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION = "prebuilt_bundle_runtime_mapping.v1";

/**
 * Resolves server-owned fixed selections for a pre-built parent Variant.
 * This module deliberately accepts no cart attributes or other client input.
 */
export function resolvePrebuiltBundleSelection({ parent_variant_gid, mapping, snapshot } = {}) {
  if (!mapping) return unresolved("UNMAPPED_PARENT_VARIANT");
  if (!isValidParentVariant(parent_variant_gid)) return unresolved("INVALID_PARENT_VARIANT");

  const mappingErrors = validatePrebuiltBundleRuntimeMapping(mapping);
  if (mappingErrors.length > 0) return unresolved("INVALID_MAPPING", mappingErrors);
  if (mapping.parent_variant_gid !== parent_variant_gid) return unresolved("UNMAPPED_PARENT_VARIANT");

  const snapshotErrors = validatePrebuiltRuntimeSnapshotForFunction(snapshot);
  if (snapshotErrors.length > 0) return unresolved("INVALID_SNAPSHOT", snapshotErrors);
  if (mapping.snapshot_checksum !== snapshot.checksum) return unresolved("SNAPSHOT_CHECKSUM_MISMATCH");
  if (mapping.bundle_definition_id !== snapshot.configuration_id) return unresolved("CONFIGURATION_ID_MISMATCH");

  const fixedSelectionErrors = validateFixedSelections(mapping.fixed_selections, snapshot);
  if (fixedSelectionErrors.length > 0) return unresolved("INVALID_FIXED_SELECTIONS", fixedSelectionErrors);

  try {
    const selectionsByCartAttribute = snapshot.groups.reduce((result, group) => {
      result[group.cart_attribute] = mapping.fixed_selections[group.key];
      return result;
    }, {});
    const resolved = resolveValidatedRuntimeBundleSelection(snapshot, selectionsByCartAttribute);

    return deepFreeze({
      status: "resolved",
      mapping: {
        bundle_definition_id: mapping.bundle_definition_id,
        published_revision_id: mapping.published_revision_id,
        parent_variant_gid: mapping.parent_variant_gid,
        snapshot_checksum: mapping.snapshot_checksum,
      },
      // Javy does not provide structuredClone. The resolved selection is
      // JSON-shaped Function data, so use the runtime-safe clone boundary.
      resolved: clonePrebuiltBundleRuntimeValue(resolved),
    });
  } catch {
    return unresolved("RESOLUTION_FAILED");
  }
}

export function validatePrebuiltBundleRuntimeMapping(mapping) {
  const errors = [];
  if (!isPlainObject(mapping)) return ["mapping must be an object"];
  if (mapping.schema_version !== PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION) {
    errors.push(`mapping.schema_version must be ${PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION}`);
  }
  if (!isValidParentVariant(mapping.parent_variant_gid)) errors.push("mapping.parent_variant_gid has invalid format");
  if (!isUuid(mapping.bundle_definition_id)) errors.push("mapping.bundle_definition_id must be a UUID");
  if (!isUuid(mapping.published_revision_id)) errors.push("mapping.published_revision_id must be a UUID");
  if (mapping.status !== "published") errors.push("mapping.status must be published");
  if (mapping.pilot_scope_approved !== true) errors.push("mapping.pilot_scope_approved must be true");
  if (!isNonEmptyString(mapping.snapshot_checksum)) errors.push("mapping.snapshot_checksum is required");
  if (!isPlainObject(mapping.fixed_selections)) errors.push("mapping.fixed_selections must be an object");
  return errors;
}

function validateFixedSelections(fixedSelections, snapshot) {
  if (!isPlainObject(fixedSelections)) return ["fixed selections must be an object"];

  const expectedKeys = new Set(snapshot.groups.map((group) => group.key));
  const errors = Object.keys(fixedSelections)
    .filter((key) => !expectedKeys.has(key))
    .sort()
    .map((key) => `fixed selections contains unknown group ${key}`);

  snapshot.groups.forEach((group) => {
    const optionKey = fixedSelections[group.key];
    if (!isNonEmptyString(optionKey)) {
      errors.push(`fixed selections.${group.key} is required`);
      return;
    }
    if (!group.options.some((option) => option.key === optionKey)) {
      errors.push(`fixed selections.${group.key} references an unknown option`);
    }
  });
  return errors;
}

function unresolved(reason, errors = []) {
  return deepFreeze({
    status: "unresolved",
    reason,
    errors: [...errors],
    resolved: null,
  });
}

function isValidParentVariant(value) {
  return typeof value === "string" && PRODUCT_VARIANT_GID_REGEX.test(value);
}

function isUuid(value) {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
