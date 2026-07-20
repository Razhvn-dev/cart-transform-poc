import { analyzeNativeBundleCompatibility } from "./native-bundle-compatibility.js";

export const NATIVE_BUNDLE_MIGRATION_INVENTORY_SCHEMA_VERSION =
  "native_bundle_migration_inventory.v1";
export const NATIVE_BUNDLE_MIGRATION_ACCEPTANCE_SCHEMA_VERSION =
  "native_bundle_migration_acceptance.v1";

export function planNativeBundleMigration(input) {
  const issues = [];
  if (!isObject(input)) return planResult("invalid", [], [invalid("INVALID_DOCUMENT", "document must be an object")]);
  if (input.schema_version !== NATIVE_BUNDLE_MIGRATION_INVENTORY_SCHEMA_VERSION) {
    issues.push(invalid("INVALID_SCHEMA", `schema_version must be ${NATIVE_BUNDLE_MIGRATION_INVENTORY_SCHEMA_VERSION}`));
  }
  if (!isObject(input.target) || !isString(input.target.store_domain)) {
    issues.push(invalid("INVALID_TARGET", "target.store_domain is required"));
  }
  if (!Array.isArray(input.products) || input.products.length === 0) {
    issues.push(invalid("INVALID_PRODUCTS", "products must be a non-empty array"));
    return planResult("invalid", [], issues);
  }

  const seen = new Set();
  const products = input.products.map((entry, index) => {
    const assessment = analyzeNativeBundleCompatibility(entry?.product);
    const productGid = assessment.product?.product_gid ?? null;
    if (assessment.status === "invalid") {
      issues.push(invalid("INVALID_PRODUCT_EVIDENCE", `products[${index}] is invalid`));
    } else if (seen.has(productGid)) {
      issues.push(invalid("DUPLICATE_PRODUCT", `products[${index}] duplicates ${productGid}`));
    } else {
      seen.add(productGid);
    }

    const needsCleanup = assessment.status === "needs_owner_app_cleanup";
    const ownerApp = isString(entry?.relationship_owner_app)
      ? entry.relationship_owner_app.trim()
      : null;
    if (needsCleanup && ownerApp === null) {
      issues.push(blocker("OWNER_APP_REQUIRED", `${productGid ?? `products[${index}]`} requires its relationship owner App`));
    }
    return deepFreeze({
      product_gid: productGid,
      title: assessment.product?.title ?? null,
      compatibility_status: assessment.status,
      relationship_owner_app: ownerApp,
      disposition: needsCleanup ? "owner_app_unlink_required" : "no_native_cleanup_required",
      approved_cleanup_steps: needsCleanup ? [
        "capture_pre_cleanup_product_evidence",
        "unlink_native_components_with_relationship_owner_app",
        "verify_requires_components_false_and_zero_component_links",
        "verify_product_edit_persistence",
        "run_cart_checkout_and_pilot_acceptance",
      ] : ["retain_cart_transform_only_configuration"],
    });
  });

  const invalidIssues = issues.filter((item) => item.kind === "invalid");
  const blockers = issues.filter((item) => item.kind === "blocker");
  const status = invalidIssues.length > 0
    ? "invalid"
    : blockers.length > 0
      ? "blocked_on_owner_identification"
      : products.some((product) => product.disposition === "owner_app_unlink_required")
        ? "ready_for_approved_cleanup"
        : "no_cleanup_required";
  return planResult(status, products, issues);
}

export function assessNativeBundleMigrationAcceptance(input) {
  const issues = [];
  if (!isObject(input)) return acceptanceResult("invalid", [invalid("INVALID_DOCUMENT", "document must be an object")]);
  if (input.schema_version !== NATIVE_BUNDLE_MIGRATION_ACCEPTANCE_SCHEMA_VERSION) {
    issues.push(invalid("INVALID_SCHEMA", `schema_version must be ${NATIVE_BUNDLE_MIGRATION_ACCEPTANCE_SCHEMA_VERSION}`));
  }

  const before = analyzeNativeBundleCompatibility(input.before_product);
  const after = analyzeNativeBundleCompatibility(input.after_product);
  if (before.status !== "needs_owner_app_cleanup") {
    issues.push(invalid("BEFORE_CONFLICT_EVIDENCE_REQUIRED", "before_product must prove a native Bundle conflict"));
  }
  if (after.status !== "native_bundle_conflict_free") {
    issues.push(failed("NATIVE_BUNDLE_STATE_REMAINS", "after_product must have requiresComponents=false and zero native component links"));
  }
  if (before.product?.product_gid && after.product?.product_gid
    && before.product.product_gid !== after.product.product_gid) {
    issues.push(failed("PRODUCT_IDENTITY_CHANGED", "before_product and after_product must refer to the same Product GID"));
  }

  requireTrue(input.cleanup?.performed_by_relationship_owner_app, "cleanup.performed_by_relationship_owner_app", issues);
  requireString(input.cleanup?.owner_app, "cleanup.owner_app", issues);
  for (const key of ["image_saved", "price_saved", "compare_at_price_saved", "reload_verified"]) {
    requireTrue(input.product_edit?.[key], `product_edit.${key}`, issues);
  }
  requireTrue(input.combined_listing?.edit_saved, "combined_listing.edit_saved", issues);
  requireTrue(input.runtime_regression?.cart_single_parent_line, "runtime_regression.cart_single_parent_line", issues);
  requireTrue(input.runtime_regression?.checkout_components_expanded, "runtime_regression.checkout_components_expanded", issues);
  requireTrue(input.runtime_regression?.pilot_acceptance_passed, "runtime_regression.pilot_acceptance_passed", issues);

  const status = issues.some((item) => item.kind === "invalid")
    ? "invalid"
    : issues.length > 0
      ? "failed"
      : "passed";
  return acceptanceResult(status, issues, after.product?.product_gid ?? null);
}

function planResult(status, products, issues) {
  return deepFreeze({
    schema_version: NATIVE_BUNDLE_MIGRATION_INVENTORY_SCHEMA_VERSION,
    status,
    cleanup_plan_ready: status === "ready_for_approved_cleanup",
    writes_performed: false,
    requires_external_approval: products.some((product) => product.disposition === "owner_app_unlink_required"),
    products,
    summary: {
      total: products.length,
      cleanup_required: products.filter((product) => product.disposition === "owner_app_unlink_required").length,
      conflict_free: products.filter((product) => product.disposition === "no_native_cleanup_required").length,
      blockers: issues.filter((item) => item.kind === "blocker").length,
      invalid: issues.filter((item) => item.kind === "invalid").length,
    },
    issues,
  });
}

function acceptanceResult(status, issues, productGid = null) {
  return deepFreeze({
    schema_version: NATIVE_BUNDLE_MIGRATION_ACCEPTANCE_SCHEMA_VERSION,
    status,
    accepted: status === "passed",
    writes_performed: false,
    product_gid: productGid,
    issues,
  });
}

function requireTrue(value, path, issues) {
  if (value !== true) issues.push(failed("EVIDENCE_REQUIRED", `${path} must be true`));
}

function requireString(value, path, issues) {
  if (!isString(value)) issues.push(failed("EVIDENCE_REQUIRED", `${path} must be a non-empty string`));
}

function invalid(code, message) {
  return { code, kind: "invalid", message };
}

function blocker(code, message) {
  return { code, kind: "blocker", message };
}

function failed(code, message) {
  return { code, kind: "failed", message };
}

function isString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
