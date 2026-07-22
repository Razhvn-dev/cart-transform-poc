import { calculateStableValueChecksum } from "../extensions/master-kit-expand/src/config/bundle-runtime.checksum.js";
import { allocateProportionally } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-price-evidenced-revision.js";

export const DEV_CATALOG_TECHNICAL_BATCH_SCOPE_SCHEMA_VERSION = "dev_catalog_technical_batch_scope.v1";
export const DEV_CATALOG_TECHNICAL_BATCH_READINESS_SCHEMA_VERSION = "dev_catalog_technical_batch_readiness.v1";

export function auditDevCatalogTechnicalBatch({ catalogReport, scope } = {}) {
  const scopeIssues = validateInputs(catalogReport, scope);
  const candidateBySku = new Map((catalogReport?.candidates ?? []).map((candidate) => [candidate?.parent_sku, candidate]));
  const seen = new Set();
  const records = (scope?.parent_skus ?? []).map((parentSku) => {
    const issues = [];
    if (seen.has(parentSku)) issues.push(issue("DUPLICATE_SCOPE_SKU", "error", "Parent SKU appears more than once in the technical batch."));
    seen.add(parentSku);
    const candidate = candidateBySku.get(parentSku);
    if (!candidate) {
      issues.push(issue("CANDIDATE_NOT_FOUND", "error", "Parent SKU is absent from the local target-mapping candidate report."));
      return record(parentSku, null, issues);
    }
    if (candidate.status !== "ready_for_target_binding") {
      issues.push(issue("CANDIDATE_NOT_READY", "error", `Candidate status is ${candidate.status ?? "missing"}.`));
    }
    if ((candidate.unresolved_skus ?? []).length > 0) {
      issues.push(issue("UNRESOLVED_SKUS", "error", "Candidate still contains unresolved catalogue SKUs."));
    }
    const parentPriceCents = moneyToCents(candidate.parent?.price);
    const components = (candidate.components ?? []).map((component) => ({
      sku: component.sku,
      quantity: component.quantity,
      variant_price_cents: moneyToCents(component.price),
      catalog_publication_state: publicationState(component),
    }));
    if (!Number.isSafeInteger(parentPriceCents) || parentPriceCents <= 0) {
      issues.push(issue("INVALID_PARENT_PRICE", "error", "Parent price must be a positive two-decimal amount."));
    }
    if (components.length === 0) issues.push(issue("COMPONENTS_REQUIRED", "error", "At least one component is required."));
    if (components.some((component) => component.quantity !== 1)) {
      issues.push(issue("UNSUPPORTED_COMPONENT_QUANTITY", "error", "V5.4 technical batches support component quantity 1 only."));
    }
    if (components.some((component) => !Number.isSafeInteger(component.variant_price_cents) || component.variant_price_cents < 0)) {
      issues.push(issue("INVALID_COMPONENT_PRICE", "error", "Every component price must be a non-negative two-decimal amount."));
    }
    const componentSubtotalCents = components.reduce((total, component) => total + (component.variant_price_cents ?? 0), 0);
    if (componentSubtotalCents <= 0 || (parentPriceCents ?? 0) > componentSubtotalCents) {
      issues.push(issue("UNSUPPORTED_PRICE_RELATIONSHIP", "error", "Parent price must not exceed the positive component subtotal."));
    }
    const unknownPublicationCount = [publicationState(candidate.parent), ...components.map((component) => component.catalog_publication_state)]
      .filter((state) => state === "unknown").length;
    if (unknownPublicationCount > 0) {
      issues.push(issue("CATALOG_STATE_READBACK_REQUIRED", "review", `${unknownPublicationCount} catalogue publication state value(s) require Shopify read-back before a live batch.`));
    }
    const allocatedPriceCents = issues.some((item) => item.severity === "error")
      ? []
      : allocateProportionally(components, parentPriceCents, componentSubtotalCents);
    return record(parentSku, {
      source_checksum: candidate.source_checksum,
      component_count: components.length,
      parent_price_cents: parentPriceCents,
      component_subtotal_cents: componentSubtotalCents,
      discount_cents: componentSubtotalCents - parentPriceCents,
      allocation_total_cents: allocatedPriceCents.reduce((total, cents) => total + cents, 0),
      components: components.map((component, index) => ({
        sku: component.sku,
        quantity: component.quantity,
        variant_price_cents: component.variant_price_cents,
        allocated_price_cents: allocatedPriceCents[index] ?? null,
        catalog_publication_state: component.catalog_publication_state,
      })),
    }, issues);
  });
  const summary = records.reduce((value, item) => {
    value.total += 1;
    value[item.status] += 1;
    return value;
  }, { total: 0, ready: 0, needs_readback: 0, blocked: 0 });
  const body = {
    schema_version: DEV_CATALOG_TECHNICAL_BATCH_READINESS_SCHEMA_VERSION,
    mode: "local_read_only",
    batch_id: scope?.batch_id ?? null,
    purpose: scope?.purpose ?? null,
    catalog_fingerprints: {
      relationships: catalogReport?.source?.preflight_relationship_fingerprint ?? null,
      variants: catalogReport?.source?.preflight_variant_catalog_fingerprint ?? null,
    },
    scope_issues: scopeIssues,
    summary,
    records,
    shopify_writes_performed: false,
  };
  return Object.freeze({ ...body, checksum: calculateStableValueChecksum(body) });
}

function record(parentSku, evidence, issues) {
  const status = issues.some((item) => item.severity === "error")
    ? "blocked"
    : issues.some((item) => item.severity === "review") ? "needs_readback" : "ready";
  return { parent_sku: parentSku, status, evidence, issues };
}

function validateInputs(catalogReport, scope) {
  const issues = [];
  if (catalogReport?.schema_version !== "dev_catalog_target_mapping_candidates.v1") {
    issues.push(issue("INVALID_CATALOG_REPORT", "error", "Unexpected target-mapping candidate schema."));
  }
  if (scope?.schema_version !== DEV_CATALOG_TECHNICAL_BATCH_SCOPE_SCHEMA_VERSION) {
    issues.push(issue("INVALID_SCOPE_SCHEMA", "error", "Unexpected technical batch scope schema."));
  }
  if (typeof scope?.batch_id !== "string" || scope.batch_id.trim() === "") {
    issues.push(issue("BATCH_ID_REQUIRED", "error", "batch_id is required."));
  }
  if (!Array.isArray(scope?.parent_skus) || scope.parent_skus.length === 0
    || scope.parent_skus.some((sku) => typeof sku !== "string" || sku.trim() === "")) {
    issues.push(issue("PARENT_SKUS_REQUIRED", "error", "parent_skus must be a non-empty string array."));
  }
  if (scope && Object.hasOwn(scope, "product_series_key")) {
    issues.push(issue("PRODUCT_SERIES_NOT_INFERRED", "error", "Technical batch scope must not assign a business product series."));
  }
  return issues;
}

function moneyToCents(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{2})$/.test(value)) return null;
  const [whole, fraction] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(cents) ? cents : null;
}

function publicationState(item) {
  if (item?.published === "true" && item?.product_status === "active") return "catalog_active";
  if (item?.published === "false" || (item?.product_status && item.product_status !== "active")) return "catalog_inactive";
  return "unknown";
}

function issue(code, severity, message) {
  return { code, severity, message };
}
