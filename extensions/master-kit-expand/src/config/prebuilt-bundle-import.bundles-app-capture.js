import {
  calculateRuntimeSnapshotChecksum,
} from "./bundle-runtime.checksum.js";
import {
  PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION,
} from "./prebuilt-bundle-import.plan.js";

export const BUNDLES_APP_CAPTURE_SCHEMA_VERSION = "bundles_app_manual_capture.v1";
export const BUNDLES_APP_SOURCE_SYSTEM = "bundles_app_inventory_sync";
export const BUNDLES_APP_PRICE_EVIDENCE_SCHEMA_VERSION = "bundles_app_price_evidence.v1";

export class BundlesAppCaptureError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BundlesAppCaptureError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/**
 * Converts the read-only Variant catalogue exported by Bundles.app plus one
 * manually captured bundle relationship into the canonical import source.
 * It performs no Shopify reads or writes and deliberately creates no target
 * mapping or Pilot Scope.
 */
export function normalizeBundlesAppCapture({ variant_csv_text, capture_document } = {}) {
  const capture = validateCapture(capture_document);
  const rows = parseBundlesAppVariantCsv(variant_csv_text);
  const skuIndex = indexVariantsBySku(rows);
  const parent = resolveUniqueSku(skuIndex, capture.parent_sku, "parent_sku");

  if (parent.type.toUpperCase() !== "BUNDLE") {
    throw new BundlesAppCaptureError(
      "PARENT_NOT_BUNDLE",
      `parent_sku ${capture.parent_sku} is not marked as BUNDLE in the Variant catalogue`,
    );
  }

  const components = capture.components.map((component, index) => {
    const variant = resolveUniqueSku(skuIndex, component.sku, `components[${index}].sku`);
    if (variant.type.toUpperCase() === "BUNDLE") {
      throw new BundlesAppCaptureError(
        "NESTED_BUNDLE_UNSUPPORTED",
        `components[${index}].sku ${component.sku} resolves to another BUNDLE`,
      );
    }
    return Object.freeze({
      variant_gid: toVariantGid(variant.variant_id, `components[${index}].variant_id`),
      quantity: component.quantity,
    });
  });

  const selectedVariants = [parent, ...capture.components.map((component, index) => (
    resolveUniqueSku(skuIndex, component.sku, `components[${index}].sku`)
  ))];
  const sourceChecksum = calculateRuntimeSnapshotChecksum({
    capture,
    selected_variants: selectedVariants.map(stableVariantIdentity),
  });
  const catalogFingerprint = calculateRuntimeSnapshotChecksum(rows.map(stableVariantIdentity));
  const captureFingerprint = calculateRuntimeSnapshotChecksum(capture);

  const sourceRecord = Object.freeze({
    schema_version: PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION,
    source_system: BUNDLES_APP_SOURCE_SYSTEM,
    source_bundle_id: capture.source_bundle_id,
    source_checksum: sourceChecksum,
    product_series_key: capture.product_series_key,
    parent_binding: Object.freeze({
      product_gid: toProductGid(parent.product_id, "parent.product_id"),
      variant_gid: toVariantGid(parent.variant_id, "parent.variant_id"),
    }),
    components: Object.freeze(components),
  });

  return deepFreeze({
    source_export: {
      source_system: BUNDLES_APP_SOURCE_SYSTEM,
      collection_mode: "bundles_app_variant_csv_plus_manual_relationship_capture",
      record_count: 1,
      raw_export_fingerprint: catalogFingerprint,
      mapping_profile_fingerprint: captureFingerprint,
    },
    source_records: [sourceRecord],
  });
}

/**
 * Reconciles the captured relationship against a Shopify product export and
 * prepares a deterministic candidate price allocation. The allocation is
 * evidence only; it does not create an executable target mapping.
 */
export function analyzeBundlesAppCapturePrices({ product_csv_text, capture_document } = {}) {
  const capture = validateCapture(capture_document);
  if (!capture.price_summary) {
    throw new BundlesAppCaptureError("PRICE_SUMMARY_REQUIRED", "capture price_summary is required for price reconciliation");
  }
  const rows = parseProductCsv(product_csv_text);
  const skuIndex = indexRowsByField(rows, "Variant SKU");
  const parent = resolveUniqueProductSku(skuIndex, capture.parent_sku, "parent_sku");
  const components = capture.components.map((component, index) => {
    const row = resolveUniqueProductSku(skuIndex, component.sku, `components[${index}].sku`);
    return Object.freeze({
      sku: component.sku,
      variant_price_cents: parseMoneyCents(row["Variant Price"], `components[${index}].Variant Price`),
      compare_at_price_cents: parseOptionalMoneyCents(row["Variant Compare At Price"], `components[${index}].Variant Compare At Price`),
    });
  });
  const bundlePriceCents = parseMoneyCents(parent["Variant Price"], "parent.Variant Price");
  const parentCompareAtPriceCents = parseOptionalMoneyCents(parent["Variant Compare At Price"], "parent.Variant Compare At Price");
  const componentSubtotalCents = components.reduce((total, component) => total + component.variant_price_cents, 0);

  assertExpectedPrice(
    componentSubtotalCents,
    capture.price_summary.expected_component_total_cents,
    "component subtotal",
  );
  assertExpectedPrice(bundlePriceCents, capture.price_summary.expected_bundle_price_cents, "bundle price");
  if (bundlePriceCents > componentSubtotalCents) {
    throw new BundlesAppCaptureError("INVALID_PRICE_EVIDENCE", "bundle price exceeds the component subtotal");
  }

  const allocated = allocateProportionally(components, bundlePriceCents, componentSubtotalCents);
  const discountCents = componentSubtotalCents - bundlePriceCents;
  return deepFreeze({
    schema_version: BUNDLES_APP_PRICE_EVIDENCE_SCHEMA_VERSION,
    parent: {
      sku: capture.parent_sku,
      variant_price_cents: bundlePriceCents,
      compare_at_price_cents: parentCompareAtPriceCents,
    },
    component_subtotal_cents: componentSubtotalCents,
    bundle_price_cents: bundlePriceCents,
    discount_cents: discountCents,
    discount_percentage: formatPercentage(discountCents, componentSubtotalCents),
    allocation_method: "proportional_to_variant_price_with_delta_to_last",
    components: components.map((component, index) => Object.freeze({
      ...component,
      allocated_price_cents: allocated[index],
    })),
    allocation_total_cents: allocated.reduce((total, cents) => total + cents, 0),
  });
}

function validateCapture(input) {
  if (!isPlainObject(input)) throw invalidCapture("capture document must be an object");
  const allowed = new Set([
    "schema_version",
    "source_bundle_id",
    "product_series_key",
    "parent_sku",
    "components",
    "price_summary",
  ]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) throw invalidCapture(`unsupported fields: ${unexpected.join(", ")}`);
  if (input.schema_version !== BUNDLES_APP_CAPTURE_SCHEMA_VERSION) {
    throw invalidCapture(`schema_version must be ${BUNDLES_APP_CAPTURE_SCHEMA_VERSION}`);
  }
  for (const field of ["source_bundle_id", "product_series_key", "parent_sku"]) {
    requireString(input[field], field);
  }
  if (!Array.isArray(input.components) || input.components.length === 0) {
    throw invalidCapture("components must be a non-empty array");
  }
  const seen = new Set();
  const components = input.components.map((component, index) => {
    if (!isPlainObject(component)) throw invalidCapture(`components[${index}] must be an object`);
    const componentKeys = Object.keys(component);
    if (componentKeys.some((key) => !["sku", "quantity"].includes(key))) {
      throw invalidCapture(`components[${index}] contains unsupported fields`);
    }
    requireString(component.sku, `components[${index}].sku`);
    if (component.quantity !== 1) {
      throw new BundlesAppCaptureError(
        "UNSUPPORTED_COMPONENT_QUANTITY",
        `components[${index}].quantity must equal 1 under the current fixed-selection contract`,
      );
    }
    const normalizedSku = component.sku.trim();
    if (seen.has(normalizedSku)) throw invalidCapture(`duplicate component SKU ${normalizedSku}`);
    seen.add(normalizedSku);
    return Object.freeze({ sku: normalizedSku, quantity: 1 });
  });
  let priceSummary = null;
  if (input.price_summary != null) {
    if (!isPlainObject(input.price_summary)) throw invalidCapture("price_summary must be an object");
    const priceKeys = Object.keys(input.price_summary);
    if (priceKeys.some((key) => !["expected_component_total_cents", "expected_bundle_price_cents"].includes(key))) {
      throw invalidCapture("price_summary contains unsupported fields");
    }
    for (const field of ["expected_component_total_cents", "expected_bundle_price_cents"]) {
      if (!Number.isSafeInteger(input.price_summary[field]) || input.price_summary[field] < 0) {
        throw invalidCapture(`price_summary.${field} must be a non-negative integer`);
      }
    }
    priceSummary = Object.freeze({
      expected_component_total_cents: input.price_summary.expected_component_total_cents,
      expected_bundle_price_cents: input.price_summary.expected_bundle_price_cents,
    });
  }
  return deepFreeze({
    schema_version: input.schema_version,
    source_bundle_id: input.source_bundle_id.trim(),
    product_series_key: input.product_series_key.trim(),
    parent_sku: input.parent_sku.trim(),
    components,
    ...(priceSummary ? { price_summary: priceSummary } : {}),
  });
}

export function parseBundlesAppVariantCsv(csvText) {
  if (typeof csvText !== "string" || csvText.trim() === "") {
    throw new BundlesAppCaptureError("INVALID_VARIANT_CSV", "Variant CSV must be non-empty text");
  }
  const records = parseCsvRecords(csvText.replace(/^\uFEFF/, ""));
  if (records.length < 2) throw new BundlesAppCaptureError("INVALID_VARIANT_CSV", "Variant CSV has no data rows");
  const headers = records[0].map((value) => value.trim());
  const required = ["sku", "title", "product_id", "variant_id", "type", "status"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new BundlesAppCaptureError("INVALID_VARIANT_CSV", `Variant CSV is missing columns: ${missing.join(", ")}`);
  }
  return records.slice(1)
    .filter((record) => record.some((value) => value !== ""))
    .map((record, rowIndex) => Object.freeze(Object.fromEntries(headers.map((header, columnIndex) => [
      header,
      (record[columnIndex] ?? "").trim(),
    ]).concat([["_row", rowIndex + 2]]))));
}

function parseProductCsv(csvText) {
  if (typeof csvText !== "string" || csvText.trim() === "") {
    throw new BundlesAppCaptureError("INVALID_PRODUCT_CSV", "Shopify product CSV must be non-empty text");
  }
  const records = parseCsvRecords(csvText.replace(/^\uFEFF/, ""));
  if (records.length < 2) throw new BundlesAppCaptureError("INVALID_PRODUCT_CSV", "Shopify product CSV has no data rows");
  const headers = records[0].map((value) => value.trim());
  const required = ["Variant SKU", "Variant Price", "Variant Compare At Price"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new BundlesAppCaptureError("INVALID_PRODUCT_CSV", `Shopify product CSV is missing columns: ${missing.join(", ")}`);
  }
  return records.slice(1)
    .filter((record) => record.some((value) => value !== ""))
    .map((record, rowIndex) => Object.freeze(Object.fromEntries(headers.map((header, columnIndex) => [
      header,
      (record[columnIndex] ?? "").trim(),
    ]).concat([["_row", rowIndex + 2]]))));
}

function parseCsvRecords(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new BundlesAppCaptureError("INVALID_VARIANT_CSV", "Variant CSV contains an unterminated quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function indexVariantsBySku(rows) {
  const index = new Map();
  rows.forEach((row) => {
    if (!row.sku) return;
    const matches = index.get(row.sku) ?? [];
    matches.push(row);
    index.set(row.sku, matches);
  });
  return index;
}

function indexRowsByField(rows, field) {
  const index = new Map();
  rows.forEach((row) => {
    const value = row[field];
    if (!value) return;
    const matches = index.get(value) ?? [];
    matches.push(row);
    index.set(value, matches);
  });
  return index;
}

function resolveUniqueSku(index, sku, field) {
  const matches = index.get(sku) ?? [];
  if (matches.length === 0) {
    throw new BundlesAppCaptureError("SKU_NOT_FOUND", `${field} ${sku} was not found in the Variant catalogue`, { field, sku });
  }
  if (matches.length > 1) {
    throw new BundlesAppCaptureError("AMBIGUOUS_SKU", `${field} ${sku} appears ${matches.length} times in the Variant catalogue`, {
      field,
      sku,
      rows: matches.map((match) => match._row),
    });
  }
  return matches[0];
}

function resolveUniqueProductSku(index, sku, field) {
  const matches = index.get(sku) ?? [];
  if (matches.length === 0) {
    throw new BundlesAppCaptureError("PRICE_SKU_NOT_FOUND", `${field} ${sku} was not found in the Shopify product CSV`, { field, sku });
  }
  if (matches.length > 1) {
    throw new BundlesAppCaptureError("AMBIGUOUS_PRICE_SKU", `${field} ${sku} appears ${matches.length} times in the Shopify product CSV`, {
      field,
      sku,
      rows: matches.map((match) => match._row),
    });
  }
  return matches[0];
}

function parseMoneyCents(value, field) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value ?? "")) {
    throw new BundlesAppCaptureError("INVALID_PRICE", `${field} must be a non-negative decimal price`);
  }
  const [dollars, fraction = ""] = value.split(".");
  const cents = (Number(dollars) * 100) + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new BundlesAppCaptureError("INVALID_PRICE", `${field} is too large`);
  return cents;
}

function parseOptionalMoneyCents(value, field) {
  return value === "" ? null : parseMoneyCents(value, field);
}

function assertExpectedPrice(actual, expected, label) {
  if (actual !== expected) {
    throw new BundlesAppCaptureError(
      "PRICE_EVIDENCE_MISMATCH",
      `${label} ${actual} does not match captured value ${expected}`,
      { actual, expected, label },
    );
  }
}

function allocateProportionally(components, targetTotalCents, sourceTotalCents) {
  if (sourceTotalCents <= 0) throw new BundlesAppCaptureError("INVALID_PRICE_EVIDENCE", "component subtotal must be positive");
  const allocated = components.map((component) => {
    const numerator = component.variant_price_cents * targetTotalCents;
    if (!Number.isSafeInteger(numerator)) {
      throw new BundlesAppCaptureError("INVALID_PRICE_ALLOCATION", "price allocation exceeds safe integer precision");
    }
    return Math.round(numerator / sourceTotalCents);
  });
  const currentTotal = allocated.reduce((total, cents) => total + cents, 0);
  if (allocated.length > 0) allocated[allocated.length - 1] += targetTotalCents - currentTotal;
  if (allocated.some((cents) => cents < 0)) {
    throw new BundlesAppCaptureError("INVALID_PRICE_ALLOCATION", "proportional allocation produced a negative component price");
  }
  return allocated;
}

function formatPercentage(numerator, denominator) {
  if (denominator === 0) return "0.00";
  const hundredths = Math.round((numerator * 10_000) / denominator);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

function stableVariantIdentity(row) {
  return {
    sku: row.sku,
    title: row.title,
    product_id: row.product_id,
    variant_id: row.variant_id,
    type: row.type,
    status: row.status,
  };
}

function toProductGid(id, field) {
  if (!/^\d+$/.test(id)) throw new BundlesAppCaptureError("INVALID_SHOPIFY_ID", `${field} must be a numeric Shopify Product ID`);
  return `gid://shopify/Product/${id}`;
}

function toVariantGid(id, field) {
  if (!/^\d+$/.test(id)) throw new BundlesAppCaptureError("INVALID_SHOPIFY_ID", `${field} must be a numeric Shopify Variant ID`);
  return `gid://shopify/ProductVariant/${id}`;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw invalidCapture(`${field} must be a non-empty string`);
}

function invalidCapture(message) {
  return new BundlesAppCaptureError("INVALID_CAPTURE", message);
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
