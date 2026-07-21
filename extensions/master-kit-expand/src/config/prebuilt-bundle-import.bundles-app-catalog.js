import {
  calculateRuntimeSnapshotChecksum,
  stableSerialize,
} from "./bundle-runtime.checksum.js";
import {
  BUNDLES_APP_SOURCE_SYSTEM,
  BundlesAppCaptureError,
  parseBundlesAppVariantCsv,
} from "./prebuilt-bundle-import.bundles-app-capture.js";

export const BUNDLES_APP_CATALOG_PREFLIGHT_SCHEMA_VERSION = "bundles_app_catalog_preflight.v1";

/**
 * Produces a deterministic, write-free review of the complete Bundles.app
 * relationship workbook against the Shopify Variant catalogue. It intentionally
 * stops before product-series inference, target mapping, Pilot Scope, or writes.
 */
export function preflightBundlesAppCatalog({ relationship_rows, variant_csv_text } = {}) {
  if (!Array.isArray(relationship_rows) || relationship_rows.length === 0) {
    throw new BundlesAppCaptureError("INVALID_RELATIONSHIP_ROWS", "relationship_rows must be a non-empty array");
  }
  const variants = parseBundlesAppVariantCsv(variant_csv_text);
  const variantIndex = indexBySku(variants);
  const parsedRows = relationship_rows.map((row, index) => parseRelationshipRow(row, index));
  const relationshipRows = parsedRows.filter((row) => row.has_relationship || row.issues.length > 0);
  const groups = groupByParentSku(relationshipRows);
  const records = [...groups.entries()]
    .map(([parentSku, rows]) => reviewParentGroup(parentSku, rows, variantIndex))
    .sort((left, right) => left.parent_sku.localeCompare(right.parent_sku));
  const issueCounts = countIssues(records);

  return deepFreeze({
    schema_version: BUNDLES_APP_CATALOG_PREFLIGHT_SCHEMA_VERSION,
    mode: "read_only",
    source_system: BUNDLES_APP_SOURCE_SYSTEM,
    source_export: {
      collection_mode: "bundles_app_relationship_xlsx_plus_variant_csv",
      relationship_row_count: relationshipRows.length,
      variant_catalog_row_count: variants.length,
      relationship_fingerprint: calculateRuntimeSnapshotChecksum(relationshipRows.map(stableRelationshipRow)),
      variant_catalog_fingerprint: calculateRuntimeSnapshotChecksum(variants.map(stableVariantIdentity)),
    },
    summary: {
      relationship_rows: relationshipRows.length,
      unique_parent_skus: records.length,
      duplicate_parent_skus: records.filter((record) => record.source_rows.length > 1).length,
      ready_for_mapping: records.filter((record) => record.status === "ready_for_mapping").length,
      rejected: records.filter((record) => record.status === "rejected").length,
      records_with_quantity_above_one: records.filter((record) => record.components.some((component) => component.quantity > 1)).length,
      issue_counts: issueCounts,
      target_mapping_required: true,
      shopify_writes_performed: false,
    },
    records,
  });
}

export function parseBundlesAppRelationshipCell(value, field = "Bundle Contents") {
  if (typeof value !== "string" || value.trim() === "" || isEmptyMarker(value)) return Object.freeze([]);
  const components = [];
  const seen = new Set();
  const lines = value.split(/\r?\n|\s*;\s*/).map((line) => line.trim()).filter(Boolean);
  lines.forEach((line) => {
    if (/^\([^)]*\)$/.test(line)) return;
    const match = line.match(/^(.+?)\s+x\s*(\d+)\s*$/i);
    if (!match) {
      throw new BundlesAppCaptureError("INVALID_BUNDLE_CONTENTS", `${field} contains an unsupported line: ${line}`, { field, line });
    }
    const sku = match[1].trim();
    const quantity = Number(match[2]);
    if (!sku || !Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new BundlesAppCaptureError("INVALID_BUNDLE_CONTENTS", `${field} contains an invalid component: ${line}`, { field, line });
    }
    if (seen.has(sku)) {
      throw new BundlesAppCaptureError("DUPLICATE_COMPONENT_SKU", `${field} repeats component SKU ${sku}`, { field, sku });
    }
    seen.add(sku);
    components.push(Object.freeze({ sku, quantity }));
  });
  if (components.length === 0) {
    throw new BundlesAppCaptureError("INVALID_BUNDLE_CONTENTS", `${field} contains no component relationships`, { field });
  }
  return Object.freeze(components);
}

function parseRelationshipRow(input, index) {
  const excelRow = Number.isSafeInteger(input?.excel_row) && input.excel_row > 1 ? input.excel_row : index + 2;
  const parentSku = normalizeString(input?.sku);
  const rawContents = normalizeString(input?.bundle_contents);
  const issues = [];
  let components = [];
  const hasRelationship = rawContents !== "" && !isEmptyMarker(rawContents);
  if (hasRelationship && !parentSku) {
    issues.push(issue("MISSING_PARENT_SKU", "error", `Excel row ${excelRow} has Bundle Contents but no SKU`, { excel_rows: [excelRow] }));
  }
  if (hasRelationship) {
    try {
      components = parseBundlesAppRelationshipCell(rawContents, `Excel row ${excelRow} Bundle Contents`);
    } catch (error) {
      issues.push(issueFromError(error, excelRow));
    }
  }
  return {
    excel_row: excelRow,
    parent_sku: parentSku || `__missing_sku_row_${excelRow}`,
    product_title: normalizeString(input?.product_title),
    variant_name: normalizeString(input?.variant_name),
    bundle_contents: rawContents,
    has_relationship: hasRelationship,
    components,
    issues,
  };
}

function reviewParentGroup(parentSku, rows, variantIndex) {
  const issues = rows.flatMap((row) => row.issues);
  const validRows = rows.filter((row) => row.components.length > 0);
  const signatures = new Map();
  validRows.forEach((row) => {
    const signature = stableSerialize(row.components);
    const matching = signatures.get(signature) ?? [];
    matching.push(row);
    signatures.set(signature, matching);
  });
  if (signatures.size > 1) {
    issues.push(issue(
      "CONFLICTING_DUPLICATE_RELATIONSHIP",
      "error",
      `Parent SKU ${displaySku(parentSku)} has conflicting component relationships`,
      { excel_rows: rows.map((row) => row.excel_row) },
    ));
  } else if (rows.length > 1) {
    issues.push(issue(
      "EXACT_DUPLICATE_PARENT_SKU",
      "warning",
      `Parent SKU ${displaySku(parentSku)} appears in multiple export rows with the same relationship`,
      { excel_rows: rows.map((row) => row.excel_row) },
    ));
  }

  const selected = validRows[0] ?? rows[0];
  const parent = resolveParentVariant(variantIndex, selected?.parent_sku, issues, rows);
  const components = (selected?.components ?? []).map((component, index) => {
    if (component.quantity !== 1) {
      issues.push(issue(
        "UNSUPPORTED_COMPONENT_QUANTITY",
        "error",
        `Component ${component.sku} quantity ${component.quantity} is not supported by the current fixed-selection contract`,
        { component_index: index, sku: component.sku, quantity: component.quantity },
      ));
    }
    const variant = resolveComponentVariant(variantIndex, component.sku, issues, index);
    return {
      sku: component.sku,
      quantity: component.quantity,
      ...(variant ? {
        product_gid: toProductGid(variant.product_id),
        variant_gid: toVariantGid(variant.variant_id),
      } : {}),
    };
  });
  const hasErrors = issues.some((item) => item.severity === "error");
  const parentBinding = parent ? {
    product_gid: toProductGid(parent.product_id),
    variant_gid: toVariantGid(parent.variant_id),
  } : null;
  const sourceChecksum = calculateRuntimeSnapshotChecksum({
    parent_sku: displaySku(parentSku),
    parent_binding: parentBinding,
    components,
  });

  return {
    parent_sku: displaySku(parentSku),
    status: hasErrors ? "rejected" : "ready_for_mapping",
    source_checksum: sourceChecksum,
    source_rows: rows.map((row) => ({
      excel_row: row.excel_row,
      product_title: row.product_title,
      variant_name: row.variant_name,
    })),
    parent_binding: parentBinding,
    components,
    issues,
  };
}

function resolveParentVariant(index, sku, issues, rows) {
  if (!sku || sku.startsWith("__missing_sku_row_")) return null;
  const matches = distinctVariantIdentities(index.get(sku) ?? []);
  const bundleMatches = matches.filter((row) => row.type.toUpperCase() === "BUNDLE");
  if (matches.length === 0) {
    issues.push(issue("PARENT_SKU_NOT_FOUND", "error", `Parent SKU ${sku} was not found in the Variant catalogue`, { sku }));
    return null;
  }
  if (bundleMatches.length === 0) {
    issues.push(issue("PARENT_NOT_BUNDLE", "error", `Parent SKU ${sku} is not marked as BUNDLE in the Variant catalogue`, {
      sku,
      excel_rows: rows.map((row) => row.excel_row),
    }));
    return null;
  }
  if (bundleMatches.length > 1) {
    issues.push(issue("AMBIGUOUS_PARENT_VARIANT", "error", `Parent SKU ${sku} resolves to ${bundleMatches.length} BUNDLE Variants`, {
      sku,
      candidates: bundleMatches.map(variantSummary),
    }));
    return null;
  }
  addInactiveWarning(bundleMatches[0], issues, "parent", sku);
  return bundleMatches[0];
}

function resolveComponentVariant(index, sku, issues, componentIndex) {
  const matches = distinctVariantIdentities(index.get(sku) ?? []);
  if (matches.length === 0) {
    issues.push(issue("COMPONENT_SKU_NOT_FOUND", "error", `Component SKU ${sku} was not found in the Variant catalogue`, { sku, component_index: componentIndex }));
    return null;
  }
  if (matches.length > 1) {
    issues.push(issue("AMBIGUOUS_COMPONENT_VARIANT", "error", `Component SKU ${sku} resolves to ${matches.length} Variants`, {
      sku,
      component_index: componentIndex,
      candidates: matches.map(variantSummary),
    }));
    return null;
  }
  if (matches[0].type.toUpperCase() === "BUNDLE") {
    issues.push(issue("NESTED_BUNDLE_UNSUPPORTED", "error", `Component SKU ${sku} resolves to another BUNDLE`, { sku, component_index: componentIndex }));
    return null;
  }
  addInactiveWarning(matches[0], issues, "component", sku);
  return matches[0];
}

function addInactiveWarning(variant, issues, role, sku) {
  if (variant.status.toLowerCase() !== "active") {
    issues.push(issue("INACTIVE_VARIANT", "warning", `${role} SKU ${sku} has Shopify status ${variant.status || "blank"}`, {
      role,
      sku,
      status: variant.status,
    }));
  }
}

function groupByParentSku(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const matching = groups.get(row.parent_sku) ?? [];
    matching.push(row);
    groups.set(row.parent_sku, matching);
  });
  return groups;
}

function indexBySku(rows) {
  const index = new Map();
  rows.forEach((row) => {
    if (!row.sku) return;
    const matching = index.get(row.sku) ?? [];
    matching.push(row);
    index.set(row.sku, matching);
  });
  return index;
}

function distinctVariantIdentities(rows) {
  return [...new Map(rows.map((row) => [`${row.product_id}:${row.variant_id}`, row])).values()];
}

function countIssues(records) {
  const counts = {};
  records.flatMap((record) => record.issues).forEach((item) => {
    const current = counts[item.code] ?? { error: 0, warning: 0 };
    current[item.severity] += 1;
    counts[item.code] = current;
  });
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function issueFromError(error, excelRow) {
  return issue(error?.code ?? "INVALID_BUNDLE_CONTENTS", "error", error?.message ?? String(error), {
    excel_rows: [excelRow],
    ...(error?.details ?? {}),
  });
}

function issue(code, severity, message, details = {}) {
  return { code, severity, message, details };
}

function stableRelationshipRow(row) {
  return {
    excel_row: row.excel_row,
    parent_sku: displaySku(row.parent_sku),
    product_title: row.product_title,
    variant_name: row.variant_name,
    components: row.components,
  };
}

function stableVariantIdentity(row) {
  return {
    sku: row.sku,
    product_id: row.product_id,
    variant_id: row.variant_id,
    type: row.type,
    status: row.status,
  };
}

function variantSummary(row) {
  return {
    product_id: row.product_id,
    variant_id: row.variant_id,
    title: row.title,
    type: row.type,
    status: row.status,
    csv_row: row._row,
  };
}

function isEmptyMarker(value) {
  return ["—", "-", "n/a"].includes(value.trim().toLowerCase());
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function displaySku(value) {
  return value.startsWith("__missing_sku_row_") ? "" : value;
}

function toProductGid(id) {
  return `gid://shopify/Product/${id}`;
}

function toVariantGid(id) {
  return `gid://shopify/ProductVariant/${id}`;
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
