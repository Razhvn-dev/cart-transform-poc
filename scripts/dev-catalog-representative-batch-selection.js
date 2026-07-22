import { calculateStableValueChecksum } from "../extensions/master-kit-expand/src/config/bundle-runtime.checksum.js";

export const DEV_CATALOG_REPRESENTATIVE_SELECTION_SCHEMA_VERSION = "dev_catalog_representative_batch_selection.v1";

export function selectDevCatalogRepresentativeBatch({ catalogReport, componentCounts, excludedParentSkus = [] } = {}) {
  assertInputs(catalogReport, componentCounts, excludedParentSkus);
  const excluded = new Set(excludedParentSkus);
  const records = componentCounts.map((componentCount) => {
    const candidates = catalogReport.candidates
      .filter((candidate) => isEligibleCandidate(candidate, componentCount, excluded))
      .sort(compareCandidates);
    const selected = candidates[0] ?? null;
    return selected ? selectionRecord(selected, componentCount, candidates.length) : {
      component_count: componentCount,
      status: "unavailable",
      eligible_candidate_count: 0,
      parent_sku: null,
      source_checksum: null,
      components: [],
      reason: "NO_ELIGIBLE_TECHNICAL_CANDIDATE",
    };
  });
  const body = {
    schema_version: DEV_CATALOG_REPRESENTATIVE_SELECTION_SCHEMA_VERSION,
    mode: "local_read_only_technical_recommendation",
    requested_component_counts: [...componentCounts],
    excluded_parent_skus: [...excludedParentSkus].sort(),
    records,
    complete: records.every((record) => record.status === "selected"),
    assigns_business_taxonomy: false,
    shopify_writes_performed: false,
  };
  return { ...body, checksum: calculateStableValueChecksum(body) };
}

function assertInputs(catalogReport, componentCounts, excludedParentSkus) {
  if (catalogReport?.schema_version !== "dev_catalog_target_mapping_candidates.v1" || !Array.isArray(catalogReport.candidates)) {
    throw new Error("catalog report must be dev_catalog_target_mapping_candidates.v1");
  }
  if (!Array.isArray(componentCounts) || componentCounts.length === 0
    || componentCounts.some((count) => !Number.isSafeInteger(count) || count < 2)
    || new Set(componentCounts).size !== componentCounts.length) {
    throw new Error("component counts must be unique integers greater than one");
  }
  if (!Array.isArray(excludedParentSkus) || excludedParentSkus.some((sku) => typeof sku !== "string" || sku.trim() === "")) {
    throw new Error("excluded parent SKUs must be non-empty strings");
  }
}

function isEligibleCandidate(candidate, componentCount, excluded) {
  return candidate?.status === "ready_for_target_binding"
    && typeof candidate.parent_sku === "string"
    && !excluded.has(candidate.parent_sku)
    && candidate.parent?.product_status === "active"
    && candidate.parent?.published === "true"
    && isPositiveMoney(candidate.parent?.price)
    && Array.isArray(candidate.components)
    && candidate.components.length === componentCount
    && candidate.components.every((component) => component?.quantity === 1
      && isUnknownOr(component.product_status, "active")
      && isUnknownOr(component.published, "true")
      && isPositiveMoney(component.price))
    && new Set(candidate.components.map((component) => component.sku)).size === componentCount;
}

function compareCandidates(left, right) {
  const leftMissingTitle = left.parent?.product_title?.trim() ? 0 : 1;
  const rightMissingTitle = right.parent?.product_title?.trim() ? 0 : 1;
  return leftMissingTitle - rightMissingTitle || left.parent_sku.localeCompare(right.parent_sku, "en");
}

function selectionRecord(candidate, componentCount, eligibleCandidateCount) {
  return {
    component_count: componentCount,
    status: "selected",
    eligible_candidate_count: eligibleCandidateCount,
    parent_sku: candidate.parent_sku,
    parent_title: candidate.parent.product_title,
    parent_price: candidate.parent.price,
    source_checksum: candidate.source_checksum,
    components: candidate.components.map(({ sku, price }) => ({ sku, price, quantity: 1 })),
    reason: "DETERMINISTIC_COMPONENT_BREADTH_REPRESENTATIVE",
  };
}

function isPositiveMoney(value) {
  return typeof value === "string" && /^\d+\.\d{2}$/.test(value) && Number(value) > 0;
}

function isUnknownOr(value, expected) {
  return value === "" || value == null || value === expected;
}
