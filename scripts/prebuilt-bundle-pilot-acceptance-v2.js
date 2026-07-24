import {
  PRODUCT_VARIANT_GID_REGEX,
  UUID_REGEX,
} from "../extensions/master-kit-expand/src/config/bundle-config.schema.js";
import {
  PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_CONTRACT_IDENTITY,
  PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_SCHEMA_VERSION,
} from "../extensions/master-kit-expand/src/config/prebuilt-bundle-expand-projection-v2.js";
import { assertPrebuiltProjectionPublicationEvidenceV2 } from "../extensions/master-kit-expand/src/config/prebuilt-projection-publication-evidence-v2.js";

export const PREBUILT_BUNDLE_PILOT_ACCEPTANCE_V2_SCHEMA_VERSION =
  "prebuilt_bundle_pilot_acceptance.v2";

const I32_MAX = 2_147_483_647;

export function assessPrebuiltBundlePilotAcceptanceV2(input) {
  const issues = [];
  if (isPlainOwnObject(input)
    && (!Object.hasOwn(input, "projection") || !Object.hasOwn(input, "publication_evidence"))) {
    return result("invalid", [
      invalid(
        "INVALID_PROJECTION_BINDING",
        "projection",
        "complete Projection and publication evidence objects are required",
      ),
    ]);
  }
  if (!hasValidAcceptanceTransportShape(input)) {
    return result("invalid", [
      invalid(
        "INVALID_DOCUMENT_SHAPE",
        "document",
        "acceptance evidence must use exact own keys and plain JSON object/array layers",
      ),
    ]);
  }
  if (input.schema_version !== PREBUILT_BUNDLE_PILOT_ACCEPTANCE_V2_SCHEMA_VERSION) {
    issues.push(invalid(
      "INVALID_SCHEMA",
      "schema_version",
      `schema_version must be ${PREBUILT_BUNDLE_PILOT_ACCEPTANCE_V2_SCHEMA_VERSION}`,
    ));
  }
  const scope = validateScope(input.pilot_scope, issues);
  if (scope !== null) {
    validateTrustedProjectionBinding(
      input.projection,
      input.publication_evidence,
      scope,
      issues,
    );
  }
  if (issues.some((item) => item.kind === "invalid")) {
    return result("invalid", issues, scope);
  }

  assessCart(input.evidence.cart, scope, issues);
  assessExpandedStage("checkout", input.evidence.checkout, scope, issues);
  assessExpandedStage("order", input.evidence.order, scope, issues);
  assessInventory(input.evidence.inventory, scope, issues);

  return result(issues.length === 0 ? "passed" : "failed", issues, scope);
}

function validateScope(scope, issues) {
  for (const field of ["store_domain", "product_series_key", "projection_checksum"]) {
    if (!isNonEmptyString(scope[field])) {
      issues.push(invalid("INVALID_PILOT_SCOPE", `pilot_scope.${field}`, `${field} is required`));
    }
  }
  if (scope.projection_schema_version !== PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_SCHEMA_VERSION) {
    issues.push(invalid(
      "INVALID_PROJECTION_SCHEMA",
      "pilot_scope.projection_schema_version",
      `projection_schema_version must be ${PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_SCHEMA_VERSION}`,
    ));
  }
  if (scope.projection_contract_identity !== PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_CONTRACT_IDENTITY) {
    issues.push(invalid(
      "INVALID_PROJECTION_CONTRACT",
      "pilot_scope.projection_contract_identity",
      `projection_contract_identity must be ${PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_CONTRACT_IDENTITY}`,
    ));
  }
  if (!PRODUCT_VARIANT_GID_REGEX.test(scope.parent_variant_gid ?? "")) {
    issues.push(invalid(
      "INVALID_PARENT_VARIANT",
      "pilot_scope.parent_variant_gid",
      "parent_variant_gid must be a Shopify ProductVariant GID",
    ));
  }
  if (!isNonNegativeSafeInteger(scope.parent_total_minor_units)) {
    issues.push(invalid(
      "INVALID_PARENT_TOTAL",
      "pilot_scope.parent_total_minor_units",
      "parent_total_minor_units must be a non-negative safe integer",
    ));
  }

  const expectedComponents = normalizeProjectedScopeComponents(
    scope.expected_components,
    issues,
  );
  const bundleInstanceIds = normalizeBundleInstanceIds(scope.bundle_instance_ids, issues);
  if (expectedComponents && isNonNegativeSafeInteger(scope.parent_total_minor_units)) {
    const expectedTotal = calculateComponentTotal(expectedComponents);
    if (expectedTotal === null || expectedTotal !== scope.parent_total_minor_units) {
      issues.push(invalid(
        "INVALID_PARENT_TOTAL",
        "pilot_scope.parent_total_minor_units",
        "parent total must equal sum(quantity * fixed_price_per_unit_minor_units)",
      ));
    }
  }
  if (issues.some((item) => item.kind === "invalid")) return null;

  return deepFreeze({
    store_domain: scope.store_domain,
    product_series_key: scope.product_series_key,
    projection_schema_version: scope.projection_schema_version,
    projection_contract_identity: scope.projection_contract_identity,
    projection_checksum: scope.projection_checksum,
    parent_variant_gid: scope.parent_variant_gid,
    parent_total_minor_units: scope.parent_total_minor_units,
    expected_components: [...expectedComponents.values()],
    bundle_instance_ids: bundleInstanceIds,
  });
}

function validateTrustedProjectionBinding(projection, publicationEvidence, scope, issues) {
  try {
    assertPrebuiltProjectionPublicationEvidenceV2(
      publicationEvidence,
      { projection },
    );
  } catch (error) {
    issues.push(invalid(
      "INVALID_PROJECTION_BINDING",
      "projection",
      `Projection/publication evidence binding is invalid: ${error.message}`,
    ));
    return;
  }

  const publicationComponents = new Map(publicationEvidence.components.map((component) => [
    component.variant_gid,
    {
      variant_gid: component.variant_gid,
      quantity: component.quantity,
      fixed_price_per_unit_minor_units: component.fixed_price_per_unit_minor_units,
    },
  ]));
  const scopeComponents = new Map(scope.expected_components.map((component) => [
    component.variant_gid,
    component,
  ]));
  if (scope.projection_schema_version !== projection.schema_version
    || scope.projection_contract_identity !== projection.contract_identity
    || scope.projection_checksum !== projection.checksum
    || scope.parent_variant_gid !== publicationEvidence.parent_variant_gid
    || scope.parent_total_minor_units !== publicationEvidence.parent_total_minor_units
    || !sameProjectedComponents(scopeComponents, publicationComponents)) {
    issues.push(invalid(
      "INVALID_PROJECTION_BINDING",
      "pilot_scope",
      "pilot_scope must exactly match the validated Projection publication evidence",
    ));
  }
}

function normalizeProjectedScopeComponents(values, issues) {
  const components = new Map();
  values.forEach((component, index) => {
    if (!PRODUCT_VARIANT_GID_REGEX.test(component.variant_gid ?? "")
      || !Number.isSafeInteger(component.quantity)
      || component.quantity <= 0
      || !isNonNegativeSafeInteger(component.fixed_price_per_unit_minor_units)
      || components.has(component.variant_gid)) {
      issues.push(invalid(
        "INVALID_COMPONENTS",
        `pilot_scope.expected_components[${index}]`,
        "components require a unique Variant, positive quantity, and non-negative safe per-unit minor price",
      ));
      return;
    }
    if (component.quantity > I32_MAX) {
      issues.push(invalid(
        "INVALID_PROJECTED_QUANTITY",
        `pilot_scope.expected_components[${index}].quantity`,
        "projected per-instance quantity must not exceed i32::MAX",
      ));
      return;
    }
    components.set(component.variant_gid, { ...component });
  });
  return components;
}

function normalizeBundleInstanceIds(values, issues) {
  const seen = new Set();
  values.forEach((value, index) => {
    if (!UUID_REGEX.test(value) || seen.has(value)) {
      issues.push(invalid(
        "INVALID_BUNDLE_INSTANCES",
        `pilot_scope.bundle_instance_ids[${index}]`,
        "bundle instance IDs must be unique UUIDs",
      ));
    } else {
      seen.add(value);
    }
  });
  return [...seen];
}

function assessCart(cart, scope, issues) {
  const expectedIds = new Set(scope.bundle_instance_ids);
  const seenIds = new Set();
  let identityMismatch = cart.instances.length !== expectedIds.size;
  cart.instances.forEach((instance, index) => {
    if (!expectedIds.has(instance.bundle_instance_id)
      || seenIds.has(instance.bundle_instance_id)) {
      identityMismatch = true;
      return;
    }
    seenIds.add(instance.bundle_instance_id);
    if (instance.parent_variant_gid !== scope.parent_variant_gid
      || instance.parent_line_count !== 1
      || instance.parent_quantity !== 1
      || instance.component_line_count !== 0
      || instance.bundle_metadata_v1_present !== true) {
      issues.push(failed(
        "CART_INSTANCE_PARENT_MISMATCH",
        `evidence.cart.instances[${index}]`,
        "each Cart bundle instance must contain one quantity-one parent and no component lines",
      ));
    }
  });
  if (identityMismatch || seenIds.size !== expectedIds.size) {
    issues.push(failed(
      "CART_INSTANCE_MISMATCH",
      "evidence.cart.instances",
      "Cart instances must exactly match the approved bundle instances",
    ));
  }
}

function assessExpandedStage(stage, evidence, scope, issues) {
  const upper = stage.toUpperCase();
  if (evidence.projection_checksum !== scope.projection_checksum) {
    issues.push(failed(
      `${upper}_PROJECTION_MISMATCH`,
      `evidence.${stage}.projection_checksum`,
      `${stage} must be bound to the validated Projection checksum`,
    ));
  }

  const observed = normalizeExpandedComponents(evidence.components, scope);
  const expected = expectedExpandedComponents(scope);
  if (observed === null || expected === null || !sameProjectedComponents(observed, expected)) {
    issues.push(failed(
      `${upper}_COMPONENT_MISMATCH`,
      `evidence.${stage}.components`,
      `${stage} components must exactly match the Projection for each bundle instance`,
    ));
  }

  const expectedTotal = safeMultiply(
    scope.parent_total_minor_units,
    scope.bundle_instance_ids.length,
  );
  if (expectedTotal === null || evidence.total_minor_units !== expectedTotal) {
    issues.push(failed(
      `${upper}_TOTAL_MISMATCH`,
      `evidence.${stage}.total_minor_units`,
      `${stage} total must exactly match the projected parent total`,
    ));
  }
}

function normalizeExpandedComponents(values, scope) {
  const approvedInstances = new Set(scope.bundle_instance_ids);
  const result = new Map();
  for (const component of values) {
    const key = expandedKey(component.bundle_instance_id, component.variant_gid);
    if (!approvedInstances.has(component.bundle_instance_id)
      || !PRODUCT_VARIANT_GID_REGEX.test(component.variant_gid ?? "")
      || !Number.isSafeInteger(component.quantity)
      || component.quantity <= 0
      || !isNonNegativeSafeInteger(component.fixed_price_per_unit_minor_units)
      || result.has(key)) {
      return null;
    }
    result.set(key, {
      variant_gid: component.variant_gid,
      quantity: component.quantity,
      fixed_price_per_unit_minor_units: component.fixed_price_per_unit_minor_units,
    });
  }
  return result;
}

function expectedExpandedComponents(scope) {
  const result = new Map();
  for (const bundleInstanceId of scope.bundle_instance_ids) {
    for (const component of scope.expected_components) {
      result.set(expandedKey(bundleInstanceId, component.variant_gid), component);
    }
  }
  return result;
}

function expandedKey(bundleInstanceId, variantGid) {
  return `${bundleInstanceId}\u0000${variantGid}`;
}

function assessInventory(inventory, scope, issues) {
  if (inventory.parent_variant_gid !== scope.parent_variant_gid || inventory.parent_delta !== 0) {
    issues.push(failed(
      "PARENT_INVENTORY_CHANGED",
      "evidence.inventory.parent_delta",
      "parent Variant inventory delta must be zero",
    ));
  }
  const observed = normalizeInventoryDeltas(inventory.component_deltas);
  const expected = new Map();
  for (const component of scope.expected_components) {
    const orderedQuantity = safeMultiply(component.quantity, scope.bundle_instance_ids.length);
    if (orderedQuantity === null) {
      issues.push(failed(
        "COMPONENT_INVENTORY_MISMATCH",
        "evidence.inventory.component_deltas",
        "component inventory quantities exceed safe integer precision",
      ));
      return;
    }
    expected.set(component.variant_gid, -orderedQuantity);
  }
  if (observed === null || !sameNumberMaps(observed, expected)) {
    issues.push(failed(
      "COMPONENT_INVENTORY_MISMATCH",
      "evidence.inventory.component_deltas",
      "component inventory delta must equal the negative aggregate ordered quantity",
    ));
  }
}

function normalizeInventoryDeltas(values) {
  const result = new Map();
  for (const component of values) {
    if (!PRODUCT_VARIANT_GID_REGEX.test(component.variant_gid ?? "")
      || !Number.isSafeInteger(component.delta)
      || result.has(component.variant_gid)) {
      return null;
    }
    result.set(component.variant_gid, component.delta);
  }
  return result;
}

function calculateComponentTotal(components) {
  let total = 0;
  for (const component of components.values()) {
    const componentTotal = safeMultiply(
      component.quantity,
      component.fixed_price_per_unit_minor_units,
    );
    if (componentTotal === null || !Number.isSafeInteger(total + componentTotal)) return null;
    total += componentTotal;
  }
  return total;
}

function sameProjectedComponents(left, right) {
  return left.size === right.size && [...left].every(([key, component]) => {
    const expected = right.get(key);
    return expected
      && component.quantity === expected.quantity
      && component.fixed_price_per_unit_minor_units
        === expected.fixed_price_per_unit_minor_units;
  });
}

function sameNumberMaps(left, right) {
  return left.size === right.size
    && [...left].every(([variantGid, value]) => right.get(variantGid) === value);
}

function hasValidAcceptanceTransportShape(input) {
  return hasExactOwnKeys(input, [
    "schema_version",
    "projection",
    "publication_evidence",
    "pilot_scope",
    "evidence",
  ])
    && hasExactOwnKeys(input.pilot_scope, [
      "store_domain",
      "product_series_key",
      "projection_schema_version",
      "projection_contract_identity",
      "projection_checksum",
      "parent_variant_gid",
      "parent_total_minor_units",
      "expected_components",
      "bundle_instance_ids",
    ])
    && isPlainArray(input.pilot_scope.expected_components)
    && input.pilot_scope.expected_components.length > 0
    && input.pilot_scope.expected_components.every((component) => hasExactOwnKeys(component, [
      "variant_gid",
      "quantity",
      "fixed_price_per_unit_minor_units",
    ]))
    && isPlainArray(input.pilot_scope.bundle_instance_ids)
    && input.pilot_scope.bundle_instance_ids.length > 0
    && hasExactOwnKeys(input.evidence, ["cart", "checkout", "order", "inventory"])
    && hasExactOwnKeys(input.evidence.cart, ["instances"])
    && isPlainArray(input.evidence.cart.instances)
    && input.evidence.cart.instances.length > 0
    && input.evidence.cart.instances.every((instance) => hasExactOwnKeys(instance, [
      "bundle_instance_id",
      "parent_variant_gid",
      "parent_line_count",
      "parent_quantity",
      "component_line_count",
      "bundle_metadata_v1_present",
    ]))
    && hasValidExpandedEvidenceShape(input.evidence.checkout)
    && hasValidExpandedEvidenceShape(input.evidence.order)
    && hasExactOwnKeys(input.evidence.inventory, [
      "parent_variant_gid",
      "parent_delta",
      "component_deltas",
    ])
    && isPlainArray(input.evidence.inventory.component_deltas)
    && input.evidence.inventory.component_deltas.length > 0
    && input.evidence.inventory.component_deltas.every((component) => hasExactOwnKeys(
      component,
      ["variant_gid", "delta"],
    ));
}

function hasValidExpandedEvidenceShape(value) {
  return hasExactOwnKeys(value, ["projection_checksum", "components", "total_minor_units"])
    && isPlainArray(value.components)
    && value.components.length > 0
    && value.components.every((component) => hasExactOwnKeys(component, [
      "bundle_instance_id",
      "variant_gid",
      "quantity",
      "fixed_price_per_unit_minor_units",
    ]));
}

function hasExactOwnKeys(value, expectedKeys) {
  if (!isPlainOwnObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
    });
}

function isPlainOwnObject(value) {
  return value != null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isPlainArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(value);
  const expectedKeys = [...value.keys()].map(String);
  return keys.length === expectedKeys.length + 1
    && keys.at(-1) === "length"
    && expectedKeys.every((key, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return keys[index] === key
        && descriptor?.enumerable === true
        && Object.hasOwn(descriptor, "value");
    });
}

function safeMultiply(left, right) {
  const value = left * right;
  return Number.isSafeInteger(value) ? value : null;
}

function result(status, issues, scope = null) {
  return deepFreeze({
    schema_version: PREBUILT_BUNDLE_PILOT_ACCEPTANCE_V2_SCHEMA_VERSION,
    status,
    accepted: status === "passed",
    pilot_scope: scope,
    summary: {
      failed: issues.filter((item) => item.kind === "failed").length,
      invalid: issues.filter((item) => item.kind === "invalid").length,
    },
    issues,
    writes_performed: false,
  });
}

function invalid(code, path, message) {
  return { code, path, message, kind: "invalid" };
}

function failed(code, path, message) {
  return { code, path, message, kind: "failed" };
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
