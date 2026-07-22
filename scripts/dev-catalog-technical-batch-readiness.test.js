import { describe, expect, it } from "vitest";

import { auditDevCatalogTechnicalBatch } from "./dev-catalog-technical-batch-readiness.js";

const catalogReport = {
  schema_version: "dev_catalog_target_mapping_candidates.v1",
  source: { preflight_relationship_fingerprint: "relationships", preflight_variant_catalog_fingerprint: "variants" },
  candidates: [{
    parent_sku: "BUNDLE-1",
    source_checksum: "source",
    status: "ready_for_target_binding",
    parent: { price: "10.00", published: "true", product_status: "active" },
    components: [
      { sku: "A", price: "8.00", quantity: 1, published: "true", product_status: "active" },
      { sku: "B", price: "4.00", quantity: 1, published: "true", product_status: "active" },
    ],
    unresolved_skus: [],
  }],
};

const scope = {
  schema_version: "dev_catalog_technical_batch_scope.v1",
  batch_id: "quantity-one-acceptance-v1",
  purpose: "Explicit technical acceptance only",
  parent_skus: ["BUNDLE-1"],
};

describe("development catalogue technical batch readiness", () => {
  it("allocates prices deterministically without assigning a business product series", () => {
    const report = auditDevCatalogTechnicalBatch({ catalogReport, scope });
    expect(report.summary).toEqual({ total: 1, ready: 1, needs_readback: 0, blocked: 0 });
    expect(report.records[0].evidence).toMatchObject({
      parent_price_cents: 1000,
      component_subtotal_cents: 1200,
      discount_cents: 200,
      allocation_total_cents: 1000,
      components: [{ allocated_price_cents: 667 }, { allocated_price_cents: 333 }],
    });
    expect(report.shopify_writes_performed).toBe(false);
  });

  it("requires live read-back when catalogue publication state is incomplete", () => {
    const input = structuredClone(catalogReport);
    input.candidates[0].components[1].published = "";
    input.candidates[0].components[1].product_status = "";
    const report = auditDevCatalogTechnicalBatch({ catalogReport: input, scope });
    expect(report.summary.needs_readback).toBe(1);
    expect(report.records[0].issues).toContainEqual(expect.objectContaining({ code: "CATALOG_STATE_READBACK_REQUIRED" }));
  });

  it("fails closed for missing candidates, duplicate scope SKUs, and unsupported prices", () => {
    const input = structuredClone(catalogReport);
    input.candidates[0].parent.price = "13.00";
    const report = auditDevCatalogTechnicalBatch({
      catalogReport: input,
      scope: { ...scope, parent_skus: ["BUNDLE-1", "BUNDLE-1", "MISSING"] },
    });
    expect(report.summary.blocked).toBe(3);
    expect(report.records[0].issues).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_PRICE_RELATIONSHIP" }));
    expect(report.records[1].issues).toContainEqual(expect.objectContaining({ code: "DUPLICATE_SCOPE_SKU" }));
    expect(report.records[2].issues).toContainEqual(expect.objectContaining({ code: "CANDIDATE_NOT_FOUND" }));
  });

  it("rejects attempts to assign a product series in a technical scope", () => {
    const report = auditDevCatalogTechnicalBatch({ catalogReport, scope: { ...scope, product_series_key: "guessed" } });
    expect(report.scope_issues).toContainEqual(expect.objectContaining({ code: "PRODUCT_SERIES_NOT_INFERRED" }));
  });
});
