import { PRODUCT_VARIANT_GID_REGEX } from "./bundle-config.schema.js";

export const PREBUILT_BUNDLE_PILOT_ACCEPTANCE_SCHEMA_VERSION = "prebuilt_bundle_pilot_acceptance.v1";

export function assessPrebuiltBundlePilotAcceptance(input) {
  const issues = [];
  if (!isPlainObject(input)) return result("invalid", [issue("INVALID_DOCUMENT", "document", "acceptance evidence must be an object")]);
  if (input.schema_version !== PREBUILT_BUNDLE_PILOT_ACCEPTANCE_SCHEMA_VERSION) {
    issues.push(issue("INVALID_SCHEMA", "schema_version", `schema_version must be ${PREBUILT_BUNDLE_PILOT_ACCEPTANCE_SCHEMA_VERSION}`));
  }
  const scope = validateScope(input.pilot_scope, issues);
  if (scope === null) return result("invalid", issues);

  assessCart(input.evidence?.cart, scope, issues);
  assessComponents("checkout", input.evidence?.checkout, scope, issues);
  assessComponents("order", input.evidence?.order, scope, issues);
  assessInventory(input.evidence?.inventory, scope, issues);
  assessFulfillment(input.evidence?.fulfillment, issues);
  assessRollback(input.evidence?.rollback, issues);

  const status = issues.some((item) => item.kind === "failed")
    ? "failed"
    : issues.length > 0
      ? "incomplete"
      : "passed";
  return result(status, issues, scope);
}

function validateScope(scope, issues) {
  if (!isPlainObject(scope)) {
    issues.push(issue("INVALID_PILOT_SCOPE", "pilot_scope", "pilot_scope must be an object"));
    return null;
  }
  for (const field of ["store_domain", "product_series_key", "parent_variant_gid"]) {
    if (!isNonEmptyString(scope[field])) issues.push(issue("INVALID_PILOT_SCOPE", `pilot_scope.${field}`, `${field} is required`));
  }
  if (isNonEmptyString(scope.parent_variant_gid) && !PRODUCT_VARIANT_GID_REGEX.test(scope.parent_variant_gid)) {
    issues.push(issue("INVALID_PILOT_SCOPE", "pilot_scope.parent_variant_gid", "parent_variant_gid must be a Shopify ProductVariant GID"));
  }
  if (!Number.isInteger(scope.bundle_quantity) || scope.bundle_quantity < 1) {
    issues.push(issue("INVALID_PILOT_SCOPE", "pilot_scope.bundle_quantity", "bundle_quantity must be a positive integer"));
  }
  if (!Array.isArray(scope.expected_components) || scope.expected_components.length === 0) {
    issues.push(issue("INVALID_PILOT_SCOPE", "pilot_scope.expected_components", "at least one expected component is required"));
  } else {
    const seen = new Set();
    scope.expected_components.forEach((component, index) => {
      if (!isPlainObject(component) || !PRODUCT_VARIANT_GID_REGEX.test(component.variant_gid ?? "")
        || !Number.isInteger(component.quantity) || component.quantity < 1) {
        issues.push(issue("INVALID_PILOT_SCOPE", `pilot_scope.expected_components[${index}]`, "component requires a Shopify ProductVariant GID and positive quantity"));
      } else if (seen.has(component.variant_gid)) {
        issues.push(issue("INVALID_PILOT_SCOPE", `pilot_scope.expected_components[${index}]`, "duplicate component Variant GID"));
      } else {
        seen.add(component.variant_gid);
      }
    });
  }
  if (issues.length > 0) return null;
  return Object.freeze({
    store_domain: scope.store_domain,
    product_series_key: scope.product_series_key,
    parent_variant_gid: scope.parent_variant_gid,
    bundle_quantity: scope.bundle_quantity,
    expected_components: Object.freeze(scope.expected_components.map((component) => Object.freeze({ ...component }))),
  });
}

function assessCart(cart, scope, issues) {
  if (!isPlainObject(cart)) {
    issues.push(pending("CART_EVIDENCE_REQUIRED", "evidence.cart", "capture /cart.js evidence"));
    return;
  }
  if (cart.parent_variant_gid !== scope.parent_variant_gid
    || cart.parent_line_count !== 1
    || cart.parent_quantity !== scope.bundle_quantity) {
    issues.push(failed("CART_PARENT_MISMATCH", "evidence.cart", "Cart must contain exactly one approved parent line with the pilot quantity"));
  }
  if (cart.component_line_count !== 0) {
    issues.push(failed("CART_COMPONENT_LINES_PRESENT", "evidence.cart.component_line_count", "Cart must not contain separate component lines"));
  }
  if (cart.bundle_metadata_v1_present !== true) {
    issues.push(failed("CART_METADATA_MISSING", "evidence.cart.bundle_metadata_v1_present", "Bundle Metadata V1 must be present"));
  }
}

function assessComponents(stage, evidence, scope, issues) {
  if (!isPlainObject(evidence)) {
    issues.push(pending(`${stage.toUpperCase()}_EVIDENCE_REQUIRED`, `evidence.${stage}`, `capture ${stage} component evidence`));
    return;
  }
  const observed = normalizeQuantities(evidence.components);
  const expected = normalizeQuantities(scope.expected_components.map((component) => ({
    variant_gid: component.variant_gid,
    quantity: component.quantity * scope.bundle_quantity,
  })));
  if (observed === null || !sameQuantities(observed, expected)) {
    issues.push(failed(`${stage.toUpperCase()}_COMPONENT_MISMATCH`, `evidence.${stage}.components`, `${stage} components must exactly match the pilot component quantities`));
  }
  if (evidence.total_matches_expected !== true) {
    issues.push(failed(`${stage.toUpperCase()}_TOTAL_MISMATCH`, `evidence.${stage}.total_matches_expected`, `${stage} total must match the approved expected total`));
  }
}

function assessInventory(inventory, scope, issues) {
  if (!isPlainObject(inventory)) {
    issues.push(pending("INVENTORY_EVIDENCE_REQUIRED", "evidence.inventory", "capture pre/post inventory deltas"));
    return;
  }
  if (inventory.parent_variant_gid !== scope.parent_variant_gid || inventory.parent_delta !== 0) {
    issues.push(failed("PARENT_INVENTORY_CHANGED", "evidence.inventory.parent_delta", "parent Variant inventory delta must be zero"));
  }
  const observed = normalizeDeltas(inventory.component_deltas);
  const expected = new Map(scope.expected_components.map((component) => [
    component.variant_gid,
    -(component.quantity * scope.bundle_quantity),
  ]));
  if (observed === null || !sameQuantities(observed, expected)) {
    issues.push(failed("COMPONENT_INVENTORY_MISMATCH", "evidence.inventory.component_deltas", "component inventory deltas must match ordered quantities"));
  }
}

function assessFulfillment(fulfillment, issues) {
  if (!isPlainObject(fulfillment) || fulfillment.decision === "unresolved") {
    issues.push(pending("FULFILLMENT_DECISION_REQUIRED", "evidence.fulfillment", "Josh must confirm main-SKU-only or component-level fulfillment semantics"));
    return;
  }
  if (!["main_sku_only", "component_level"].includes(fulfillment.decision)) {
    issues.push(failed("INVALID_FULFILLMENT_DECISION", "evidence.fulfillment.decision", "unsupported fulfillment decision"));
  } else if (fulfillment.observed_and_accepted !== true) {
    issues.push(pending("FULFILLMENT_EVIDENCE_REQUIRED", "evidence.fulfillment.observed_and_accepted", "capture and accept fulfillment evidence"));
  }
}

function assessRollback(rollback, issues) {
  if (!isPlainObject(rollback)) {
    issues.push(pending("ROLLBACK_EVIDENCE_REQUIRED", "evidence.rollback", "document known-good rollback and regression evidence"));
    return;
  }
  if (!isNonEmptyString(rollback.known_good_version)
    || rollback.procedure_documented !== true
    || rollback.regression_verified !== true) {
    issues.push(pending("ROLLBACK_NOT_READY", "evidence.rollback", "known-good version, procedure, and regression verification are required"));
  }
}

function normalizeQuantities(components) {
  if (!Array.isArray(components)) return null;
  const result = new Map();
  for (const component of components) {
    if (!isPlainObject(component) || !PRODUCT_VARIANT_GID_REGEX.test(component.variant_gid ?? "")
      || !Number.isInteger(component.quantity) || component.quantity < 1 || result.has(component.variant_gid)) return null;
    result.set(component.variant_gid, component.quantity);
  }
  return result;
}

function normalizeDeltas(components) {
  if (!Array.isArray(components)) return null;
  const result = new Map();
  for (const component of components) {
    if (!isPlainObject(component) || !PRODUCT_VARIANT_GID_REGEX.test(component.variant_gid ?? "")
      || !Number.isInteger(component.delta) || result.has(component.variant_gid)) return null;
    result.set(component.variant_gid, component.delta);
  }
  return result;
}

function sameQuantities(left, right) {
  return left.size === right.size && [...left].every(([key, value]) => right.get(key) === value);
}

function result(status, issues, scope = null) {
  return deepFreeze({
    schema_version: PREBUILT_BUNDLE_PILOT_ACCEPTANCE_SCHEMA_VERSION,
    status,
    accepted: status === "passed",
    pilot_scope: scope,
    summary: {
      failed: issues.filter((item) => item.kind === "failed").length,
      pending: issues.filter((item) => item.kind === "pending").length,
      invalid: issues.filter((item) => item.kind === "invalid").length,
    },
    issues,
  });
}

function issue(code, path, message, kind = "invalid") {
  return { code, path, message, kind };
}

function pending(code, path, message) {
  return issue(code, path, message, "pending");
}

function failed(code, path, message) {
  return issue(code, path, message, "failed");
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
