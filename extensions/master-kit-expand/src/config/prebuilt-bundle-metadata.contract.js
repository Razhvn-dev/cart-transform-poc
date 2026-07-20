import {
  PRODUCT_GID_REGEX,
  PRODUCT_VARIANT_GID_REGEX,
  UUID_REGEX,
} from "./bundle-config.schema.js";

export const PREBUILT_BUNDLE_METADATA_SCHEMA_VERSION = "1";

/**
 * Creates the non-authoritative cart metadata needed to correlate component
 * lines belonging to one normal-product pre-built Bundle add-to-cart action.
 * Component choices, prices, mapping IDs, and Snapshot values are rejected by
 * omission: they never belong to this client-facing metadata contract.
 */
export function createPrebuiltBundleCartMetadata({ bundle_instance_id, parent } = {}) {
  const errors = validatePrebuiltBundleCartMetadataInput({ bundle_instance_id, parent });
  if (errors.length > 0) return deepFreeze({ ok: false, errors, properties: null });

  return deepFreeze({
    ok: true,
    errors: [],
    properties: {
      _bundle_id: bundle_instance_id,
      _bundle_schema_version: PREBUILT_BUNDLE_METADATA_SCHEMA_VERSION,
      _parent_product_gid: parent.product_gid,
      _parent_variant_gid: parent.variant_gid,
      _parent_sku: normalizeOptionalText(parent.sku),
      _parent_title: normalizeOptionalText(parent.title),
    },
  });
}

export function validatePrebuiltBundleCartMetadataInput({ bundle_instance_id, parent } = {}) {
  const errors = [];
  if (typeof bundle_instance_id !== "string" || !UUID_REGEX.test(bundle_instance_id)) {
    errors.push("bundle_instance_id must be a UUID");
  }
  if (!isPlainObject(parent)) {
    errors.push("parent must be an object");
    return errors;
  }
  if (typeof parent.product_gid !== "string" || !PRODUCT_GID_REGEX.test(parent.product_gid)) {
    errors.push("parent.product_gid has invalid format");
  }
  if (typeof parent.variant_gid !== "string" || !PRODUCT_VARIANT_GID_REGEX.test(parent.variant_gid)) {
    errors.push("parent.variant_gid has invalid format");
  }
  if (parent.sku != null && typeof parent.sku !== "string") errors.push("parent.sku must be a string");
  if (parent.title != null && typeof parent.title !== "string") errors.push("parent.title must be a string");
  return errors;
}

function normalizeOptionalText(value) {
  return typeof value === "string" ? value : "";
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
