import {
  PRODUCT_GID_REGEX,
  PRODUCT_VARIANT_GID_REGEX,
  UUID_REGEX,
} from "./bundle-config.schema.js";

/**
 * Reads only the correlation metadata already returned by the Cart Transform
 * query. This module is a local observation boundary, not a mapping or
 * component authority: all component resolution remains server-owned.
 */
export function observePrebuiltBundleCartMetadata(cartLine, freeze = true) {
  const metadata = readMetadata(cartLine);
  if (!isNonEmptyString(cartLine?.id)) return result("invalid", "CART_LINE_ID_MISSING", freeze);
  if (!metadata.bundle_instance_id) return result("missing", "BUNDLE_INSTANCE_ID_MISSING", freeze);
  if (!UUID_REGEX.test(metadata.bundle_instance_id)) return result("invalid", "BUNDLE_INSTANCE_ID_INVALID", freeze);
  if (metadata.schema_version !== "1") return result("invalid", "BUNDLE_SCHEMA_VERSION_INVALID", freeze);
  if (cartLine?.quantity !== 1) return result("invalid", "BUNDLE_QUANTITY_NOT_SINGLE", freeze);

  const merchandise = cartLine?.merchandise;
  if (merchandise?.__typename !== "ProductVariant") return result("invalid", "PARENT_MERCHANDISE_INVALID", freeze);
  if (!PRODUCT_VARIANT_GID_REGEX.test(merchandise.id)) return result("invalid", "PARENT_VARIANT_INVALID", freeze);
  if (!PRODUCT_GID_REGEX.test(merchandise.product?.id)) return result("invalid", "PARENT_PRODUCT_INVALID", freeze);
  if (metadata.parent_variant_gid !== merchandise.id) return result("invalid", "PARENT_VARIANT_MISMATCH", freeze);
  if (metadata.parent_product_gid !== merchandise.product.id) return result("invalid", "PARENT_PRODUCT_MISMATCH", freeze);

  const normalizedMetadata = {
    bundle_instance_id: metadata.bundle_instance_id,
    schema_version: metadata.schema_version,
    parent_product_gid: metadata.parent_product_gid,
    parent_variant_gid: metadata.parent_variant_gid,
    parent_sku: metadata.parent_sku,
    parent_title: metadata.parent_title,
  };
  if (!freeze) return normalizedMetadata;
  return deepFreeze({ status: "valid", reason: null, metadata: normalizedMetadata });
}

function readMetadata(line) {
  return {
    bundle_instance_id: readAttribute(line, "bundleId", "_bundle_id"),
    schema_version: readAttribute(line, "bundleSchemaVersion", "_bundle_schema_version"),
    parent_product_gid: readAttribute(line, "parentProductGid", "_parent_product_gid"),
    parent_variant_gid: readAttribute(line, "parentVariantGid", "_parent_variant_gid"),
    parent_sku: readAttribute(line, "parentSku", "_parent_sku") ?? "",
    parent_title: readAttribute(line, "parentTitle", "_parent_title") ?? "",
  };
}

function readAttribute(line, queryField, attributeKey) {
  const queriedValue = line?.[queryField]?.value;
  if (typeof queriedValue === "string") return queriedValue;
  const attribute = Array.isArray(line?.attributes)
    ? line.attributes.find((item) => item?.key === attributeKey)
    : null;
  return typeof attribute?.value === "string" ? attribute.value : null;
}

function result(status, reason, freeze) {
  if (!freeze) return null;
  const observed = { status, reason, metadata: null };
  return deepFreeze(observed);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
