import {
  BUNDLE_RUNTIME_SCHEMA_VERSION,
  PRODUCT_GID_REGEX,
  PRODUCT_VARIANT_GID_REGEX,
  RUNTIME_SNAPSHOT_HASH_ALGORITHM,
  UUID_REGEX,
} from "./bundle-config.schema.js";
import { calculateRuntimeSnapshotChecksum } from "./bundle-runtime.checksum.js";

// Hosted pre-built candidates consume compiler-produced Snapshots. Validate the
// complete trust boundary and every field used by resolution without building
// the large diagnostic error graph used by Admin/compiler workflows.
export function validatePrebuiltRuntimeSnapshotForFunction(snapshot) {
  if (!isPlainObject(snapshot)) return ["SNAPSHOT_NOT_OBJECT"];
  if (snapshot.snapshot_schema !== BUNDLE_RUNTIME_SCHEMA_VERSION) return ["SNAPSHOT_SCHEMA_INVALID"];
  if (!UUID_REGEX.test(snapshot.configuration_id ?? "")) return ["CONFIGURATION_ID_INVALID"];
  if (!Number.isInteger(snapshot.configuration_version) || snapshot.configuration_version < 1) {
    return ["CONFIGURATION_VERSION_INVALID"];
  }
  if (snapshot.checksum_algorithm !== RUNTIME_SNAPSHOT_HASH_ALGORITHM) return ["CHECKSUM_ALGORITHM_INVALID"];
  if (typeof snapshot.checksum !== "string" || calculateRuntimeSnapshotChecksum(snapshot) !== snapshot.checksum) {
    return ["CHECKSUM_INVALID"];
  }
  if (!isValidParent(snapshot.parent)) return ["PARENT_INVALID"];
  if (!Array.isArray(snapshot.groups) || snapshot.groups.length === 0) return ["GROUPS_INVALID"];
  if (!snapshot.groups.every(isValidGroup)) return ["GROUP_INVALID"];
  if (!Array.isArray(snapshot.rules) || !snapshot.rules.every(isUsableRule)) return ["RULES_INVALID"];
  const basisPoints = snapshot?.pricing?.discount?.basis_points;
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
    return ["PRICING_INVALID"];
  }
  if (snapshot?.metadata?.bundle_contract_version !== "1") return ["METADATA_INVALID"];
  return [];
}

function isValidParent(parent) {
  return isPlainObject(parent)
    && PRODUCT_GID_REGEX.test(parent.product_gid ?? "")
    && PRODUCT_VARIANT_GID_REGEX.test(parent.variant_gid ?? "")
    && isNonEmptyString(parent.sku)
    && isNonEmptyString(parent.title);
}

function isValidGroup(group) {
  if (!isPlainObject(group) || !isNonEmptyString(group.key) || !isNonEmptyString(group.role)) return false;
  if (!isNonEmptyString(group.cart_attribute) || typeof group.required !== "boolean") return false;
  if (!Array.isArray(group.options) || group.options.length === 0) return false;
  if (!group.options.every(isValidOption)) return false;
  return group.options.some((option) => option.key === group.default_option);
}

function isValidOption(option) {
  return isPlainObject(option)
    && isNonEmptyString(option.key)
    && PRODUCT_GID_REGEX.test(option.product_gid ?? "")
    && PRODUCT_VARIANT_GID_REGEX.test(option.variant_gid ?? "")
    && isNonEmptyString(option.sku)
    && isNonEmptyString(option.label)
    && Number.isInteger(option.price_cents)
    && option.price_cents >= 0;
}

function isUsableRule(rule) {
  return isPlainObject(rule)
    && Array.isArray(rule.when)
    && isPlainObject(rule.target)
    && isNonEmptyString(rule.target.group);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
