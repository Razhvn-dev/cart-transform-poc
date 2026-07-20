export const NATIVE_BUNDLE_COMPATIBILITY_SCHEMA_VERSION = "native_bundle_compatibility.v1";

export function analyzeNativeBundleCompatibility(product) {
  if (!isObject(product) || !isNonEmptyString(product.id) || !Array.isArray(product.variants?.nodes)) {
    return result("invalid", null, [{
      code: "INVALID_PRODUCT_EVIDENCE",
      message: "product id and variants.nodes are required",
    }]);
  }

  const variants = product.variants.nodes.map((variant) => ({
    id: variant?.id ?? null,
    title: variant?.title ?? null,
    sku: variant?.sku ?? null,
    requires_components: variant?.requiresComponents === true,
    component_count: Array.isArray(variant?.productVariantComponents?.nodes)
      ? variant.productVariantComponents.nodes.length
      : 0,
  }));
  const combinedListingRole = product.combinedListingRole ?? null;
  const requiresComponents = variants.filter((variant) => variant.requires_components);
  const linkedComponents = variants.filter((variant) => variant.component_count > 0);
  const issues = [];

  if (combinedListingRole && (requiresComponents.length > 0 || linkedComponents.length > 0)) {
    issues.push({
      code: "COMBINED_LISTING_NATIVE_BUNDLE_CONFLICT",
      message: "Combined Listing products cannot also use Shopify native bundle relationships.",
    });
  }
  if (requiresComponents.length > 0) {
    issues.push({
      code: "REQUIRES_COMPONENTS_ENABLED",
      message: "One or more Variants still require Shopify native bundle components.",
      variant_gids: requiresComponents.map((variant) => variant.id),
    });
  }
  if (linkedComponents.length > 0) {
    issues.push({
      code: "NATIVE_COMPONENT_RELATIONSHIPS_PRESENT",
      message: "One or more Variants still have Shopify native component relationships.",
      variant_gids: linkedComponents.map((variant) => variant.id),
    });
  }

  const status = issues.length > 0 ? "needs_owner_app_cleanup" : "native_bundle_conflict_free";
  return result(status, {
    product_gid: product.id,
    title: product.title ?? null,
    combined_listing_role: combinedListingRole,
    variants,
  }, issues);
}

function result(status, product, issues) {
  return Object.freeze({
    schema_version: NATIVE_BUNDLE_COMPATIBILITY_SCHEMA_VERSION,
    status,
    native_bundle_conflict_free: status === "native_bundle_conflict_free",
    product,
    issues,
    next_action: status === "needs_owner_app_cleanup"
      ? "Use the app that owns the native bundle relationship to unlink all components, then verify requiresComponents is false."
      : status === "native_bundle_conflict_free"
        ? "No native bundle cleanup is required; validate normal product edits and Cart Transform behavior separately."
        : "Capture valid read-only Product evidence before planning cleanup.",
  });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}
