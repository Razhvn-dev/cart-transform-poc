export const PREBUILT_SUPPLIER_PRESENTATION_SCHEMA_VERSION = "prebuilt_supplier_presentation.v1";

const TOP_LEVEL_KEYS = ["schema_version", "order", "mappings"];
const ORDER_KEYS = ["order_id", "component_lines"];
const COMPONENT_LINE_KEYS = [
  "line_id",
  "variant_gid",
  "sku",
  "quantity",
  "bundle_instance_id",
  "fulfillment_identity",
];
const MAPPING_KEYS = [
  "bundle_instance_id",
  "main_kit_sku",
  "fulfillment_identity",
  "mapping_trace_id",
];
const FULFILLMENT_IDENTITY_KEYS = ["supplier_id", "location_id"];
const PRODUCT_VARIANT_GID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/\d+$/;

export function buildPrebuiltSupplierPresentation(input) {
  const issues = [];
  validateInput(input, issues);
  if (issues.some((item) => item.kind === "invalid")) {
    return createResult("invalid", [], [], issues);
  }

  const componentLinesByBundle = groupBy(
    input.order.component_lines,
    (line) => line.bundle_instance_id,
  );
  const mappingsByBundle = groupBy(
    input.mappings,
    (mapping) => mapping.bundle_instance_id,
  );
  const aggregated = new Map();

  for (const [bundleInstanceId, componentLines] of componentLinesByBundle) {
    const mappings = mappingsByBundle.get(bundleInstanceId) ?? [];
    if (mappings.length === 0) {
      issues.push(needsReview(
        "MISSING_MAIN_KIT_MAPPING",
        "mappings",
        bundleInstanceId,
        "bundle instance requires exactly one supplier main Kit SKU mapping",
      ));
      continue;
    }
    if (mappings.length !== 1) {
      issues.push(needsReview(
        "CONFLICTING_BUNDLE_MAPPING",
        "mappings",
        bundleInstanceId,
        "bundle instance has multiple supplier mappings",
      ));
      continue;
    }

    const mapping = mappings[0];
    const componentSuppliers = unique(
      componentLines.map((line) => line.fulfillment_identity.supplier_id),
    );
    if (componentSuppliers.length !== 1) {
      issues.push(needsReview(
        "CROSS_SUPPLIER_BUNDLE_INSTANCE",
        "order.component_lines",
        bundleInstanceId,
        "one bundle instance cannot span multiple suppliers",
      ));
      continue;
    }
    if (componentSuppliers[0] !== mapping.fulfillment_identity.supplier_id) {
      issues.push(needsReview(
        "CROSS_SUPPLIER_BUNDLE_INSTANCE",
        "mappings",
        bundleInstanceId,
        "component Order and supplier mapping must identify the same supplier",
      ));
      continue;
    }

    const componentFulfillmentIdentities = unique(
      componentLines.map((line) => fulfillmentIdentityKey(line.fulfillment_identity)),
    );
    if (componentFulfillmentIdentities.length !== 1
      || componentFulfillmentIdentities[0] !== fulfillmentIdentityKey(mapping.fulfillment_identity)) {
      issues.push(needsReview(
        "FULFILLMENT_IDENTITY_CONFLICT",
        "mappings",
        bundleInstanceId,
        "component Order and supplier mapping fulfillment identities must match exactly",
      ));
      continue;
    }

    const aggregateKey = JSON.stringify([
      mapping.main_kit_sku,
      mapping.fulfillment_identity.supplier_id,
      mapping.fulfillment_identity.location_id,
    ]);
    const existing = aggregated.get(aggregateKey);
    if (existing) {
      existing.quantity += 1;
      existing.bundle_instance_ids.push(bundleInstanceId);
      existing.component_line_ids.push(...componentLines.map((line) => line.line_id));
      existing.mapping_trace_ids.push(mapping.mapping_trace_id);
      continue;
    }

    aggregated.set(aggregateKey, {
      main_kit_sku: mapping.main_kit_sku,
      quantity: 1,
      fulfillment_identity: { ...mapping.fulfillment_identity },
      bundle_instance_ids: [bundleInstanceId],
      component_line_ids: componentLines.map((line) => line.line_id),
      mapping_trace_ids: [mapping.mapping_trace_id],
    });
  }

  for (const mapping of input.mappings) {
    if (!componentLinesByBundle.has(mapping.bundle_instance_id)) {
      issues.push(needsReview(
        "UNREFERENCED_BUNDLE_MAPPING",
        "mappings",
        mapping.bundle_instance_id,
        "supplier mapping does not reference an internal component Order bundle instance",
      ));
    }
  }

  const supplierLines = [];
  const reconciliationTrace = [];
  for (const aggregate of aggregated.values()) {
    const supplierLineIndex = supplierLines.length;
    supplierLines.push({
      main_kit_sku: aggregate.main_kit_sku,
      quantity: aggregate.quantity,
      fulfillment_identity: aggregate.fulfillment_identity,
    });
    reconciliationTrace.push({
      supplier_line_index: supplierLineIndex,
      order_id: input.order.order_id,
      bundle_instance_ids: aggregate.bundle_instance_ids,
      component_line_ids: aggregate.component_line_ids,
      mapping_trace_ids: aggregate.mapping_trace_ids,
    });
  }

  return createResult(
    issues.length === 0 ? "ready" : "needs_review",
    supplierLines,
    reconciliationTrace,
    issues,
  );
}

function validateInput(input, issues) {
  if (!isPlainObject(input)) {
    issues.push(invalid("INVALID_DOCUMENT", "document", "supplier presentation input must be an object"));
    return;
  }
  rejectUnknownKeys(input, TOP_LEVEL_KEYS, "input", issues);
  if (!hasOwn(input, "schema_version")
    || input.schema_version !== PREBUILT_SUPPLIER_PRESENTATION_SCHEMA_VERSION) {
    issues.push(invalid(
      "INVALID_SCHEMA",
      "schema_version",
      `schema_version must be ${PREBUILT_SUPPLIER_PRESENTATION_SCHEMA_VERSION}`,
    ));
  }
  validateOrder(hasOwn(input, "order") ? input.order : undefined, issues);
  validateMappings(hasOwn(input, "mappings") ? input.mappings : undefined, issues);
}

function validateOrder(order, issues) {
  if (!isPlainObject(order)) {
    issues.push(invalid("INVALID_ORDER", "order", "order must be an object"));
    return;
  }
  rejectUnknownKeys(order, ORDER_KEYS, "order", issues);
  if (!hasOwn(order, "order_id") || !isNonEmptyString(order.order_id)) {
    issues.push(invalid("INVALID_ORDER_ID", "order.order_id", "order_id must be a non-empty string"));
  }
  if (!hasOwn(order, "component_lines")
    || !Array.isArray(order.component_lines)
    || order.component_lines.length === 0) {
    issues.push(invalid(
      "INVALID_COMPONENT_LINES",
      "order.component_lines",
      "component_lines must be a non-empty array",
    ));
    return;
  }

  const lineIds = new Map();
  order.component_lines.forEach((line, index) => {
    const path = `order.component_lines[${index}]`;
    if (!isPlainObject(line)) {
      issues.push(invalid("INVALID_COMPONENT_LINE", path, "component line must be an object"));
      return;
    }
    rejectUnknownKeys(line, COMPONENT_LINE_KEYS, path, issues);
    if (!hasOwn(line, "line_id") || !isNonEmptyString(line.line_id)) {
      issues.push(invalid("INVALID_COMPONENT_LINE_ID", `${path}.line_id`, "line_id must be a non-empty string"));
    } else if (lineIds.has(line.line_id)) {
      issues.push(invalid(
        "DUPLICATE_COMPONENT_LINE_ID",
        `${path}.line_id`,
        `line_id duplicates order.component_lines[${lineIds.get(line.line_id)}].line_id`,
      ));
    } else {
      lineIds.set(line.line_id, index);
    }
    if (!hasOwn(line, "variant_gid")
      || typeof line.variant_gid !== "string"
      || !PRODUCT_VARIANT_GID_PATTERN.test(line.variant_gid)) {
      issues.push(invalid(
        "INVALID_COMPONENT_VARIANT_GID",
        `${path}.variant_gid`,
        "variant_gid must be a Shopify ProductVariant GID",
      ));
    }
    if (!hasOwn(line, "sku") || !isNonEmptyString(line.sku)) {
      issues.push(invalid("INVALID_COMPONENT_SKU", `${path}.sku`, "sku must be a non-empty string"));
    }
    if (!hasOwn(line, "quantity") || !Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      issues.push(invalid(
        "INVALID_COMPONENT_QUANTITY",
        `${path}.quantity`,
        "quantity must be a positive safe integer",
      ));
    }
    if (!hasOwn(line, "bundle_instance_id") || !isNonEmptyString(line.bundle_instance_id)) {
      issues.push(invalid(
        "INVALID_BUNDLE_INSTANCE_ID",
        `${path}.bundle_instance_id`,
        "bundle_instance_id must be a non-empty string",
      ));
    }
    validateFulfillmentIdentity(
      hasOwn(line, "fulfillment_identity") ? line.fulfillment_identity : undefined,
      `${path}.fulfillment_identity`,
      issues,
    );
  });
}

function validateMappings(mappings, issues) {
  if (!Array.isArray(mappings)) {
    issues.push(invalid("INVALID_MAPPINGS", "mappings", "mappings must be an array"));
    return;
  }
  mappings.forEach((mapping, index) => {
    const path = `mappings[${index}]`;
    if (!isPlainObject(mapping)) {
      issues.push(invalid("INVALID_MAPPING", path, "mapping must be an object"));
      return;
    }
    rejectUnknownKeys(mapping, MAPPING_KEYS, path, issues);
    if (!hasOwn(mapping, "bundle_instance_id") || !isNonEmptyString(mapping.bundle_instance_id)) {
      issues.push(invalid(
        "INVALID_BUNDLE_INSTANCE_ID",
        `${path}.bundle_instance_id`,
        "bundle_instance_id must be a non-empty string",
      ));
    }
    if (!hasOwn(mapping, "main_kit_sku") || !isNonEmptyString(mapping.main_kit_sku)) {
      issues.push(invalid(
        "INVALID_MAIN_KIT_SKU",
        `${path}.main_kit_sku`,
        "main_kit_sku must be a non-empty string",
      ));
    }
    if (!hasOwn(mapping, "mapping_trace_id") || !isNonEmptyString(mapping.mapping_trace_id)) {
      issues.push(invalid(
        "INVALID_MAPPING_TRACE_ID",
        `${path}.mapping_trace_id`,
        "mapping_trace_id must be a non-empty string",
      ));
    }
    validateFulfillmentIdentity(
      hasOwn(mapping, "fulfillment_identity") ? mapping.fulfillment_identity : undefined,
      `${path}.fulfillment_identity`,
      issues,
    );
  });
}

function validateFulfillmentIdentity(value, path, issues) {
  if (!isPlainObject(value)) {
    issues.push(invalid(
      "INVALID_FULFILLMENT_IDENTITY",
      path,
      "fulfillment_identity must be an object",
    ));
    return;
  }
  rejectUnknownKeys(value, FULFILLMENT_IDENTITY_KEYS, path, issues);
  for (const field of FULFILLMENT_IDENTITY_KEYS) {
    if (!hasOwn(value, field) || !isNonEmptyString(value[field])) {
      issues.push(invalid(
        "INVALID_FULFILLMENT_IDENTITY",
        `${path}.${field}`,
        `${field} must be a non-empty string`,
      ));
    }
  }
}

function rejectUnknownKeys(value, allowedKeys, path, issues) {
  Object.keys(value).sort().forEach((key) => {
    if (!allowedKeys.includes(key)) {
      issues.push(invalid("UNKNOWN_FIELD", `${path}.${key}`, `${path}.${key} is not allowed`));
    }
  });
}

function groupBy(values, keyForValue) {
  const result = new Map();
  for (const value of values) {
    const key = keyForValue(value);
    const group = result.get(key);
    if (group) group.push(value);
    else result.set(key, [value]);
  }
  return result;
}

function fulfillmentIdentityKey(identity) {
  return JSON.stringify([identity.supplier_id, identity.location_id]);
}

function unique(values) {
  return [...new Set(values)];
}

function createResult(status, supplierLines, reconciliationTrace, issues) {
  return deepFreeze({
    schema_version: PREBUILT_SUPPLIER_PRESENTATION_SCHEMA_VERSION,
    status,
    supplier_lines: supplierLines,
    reconciliation_trace: reconciliationTrace,
    inventory_authority: "internal_component_order",
    parent_inventory_authority: false,
    writes_performed: false,
    issues,
  });
}

function invalid(code, path, message) {
  return { code, path, message, kind: "invalid" };
}

function needsReview(code, path, bundleInstanceId, message) {
  return {
    code,
    path,
    bundle_instance_id: bundleInstanceId,
    message,
    kind: "needs_review",
  };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
