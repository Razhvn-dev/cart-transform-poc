export const BUNDLE_CONFIG_SCHEMA_VERSION = "bundle_config.v1";
export const BUNDLE_RUNTIME_SCHEMA_VERSION = "bundle_runtime.v1";

export const CONFIG_STATUSES = new Set(["draft", "active", "archived"]);
export const VARIANT_SELECTION_STRATEGIES = new Set(["fixed"]);
export const CART_PARENT_LINE_MODES = new Set(["single_parent_line"]);
export const CHECKOUT_LINE_MODES = new Set(["expanded_components"]);
export const SELECTION_UI_TYPES = new Set(["select"]);
export const RULE_EFFECTS = new Set([
  "allow",
  "deny",
  "requires",
  "excludes",
  "visibility",
  "fallback",
]);
export const RULE_MATCH_MODES = new Set(["all", "any"]);
export const CONDITION_OPERATORS = new Set(["selected"]);
export const DISCOUNT_TYPES = new Set(["percentage", "fixed_amount", "none"]);
export const DISCOUNT_ALLOCATIONS = new Set([
  "per_component_with_delta_to_last_line",
]);
export const RUNTIME_SNAPSHOT_HASH_ALGORITHM = "fnv1a-32";

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PRODUCT_GID_REGEX = /^gid:\/\/shopify\/Product\/\d+$/;
export const PRODUCT_VARIANT_GID_REGEX =
  /^gid:\/\/shopify\/ProductVariant\/\d+$/;
export const MEDIA_IMAGE_GID_REGEX = /^gid:\/\/shopify\/MediaImage\/\d+$/;
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const KEY_REGEX = /^[a-z][a-z0-9_]*$/;
