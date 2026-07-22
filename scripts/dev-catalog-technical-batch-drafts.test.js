import { describe, expect, it } from "vitest";

import { validateBundleConfig } from "../extensions/master-kit-expand/src/config/bundle-config.validator.js";
import { prepareDevCatalogTechnicalBatchDrafts } from "./dev-catalog-technical-batch-drafts.js";

const scope = {
  batch_id: "batch-v1",
  parent_skus: ["NEW", "EXISTING"],
  existing_parent_skus: ["EXISTING"],
  draft_created_at: "2026-07-21T09:30:00.000Z",
  draft_created_by: "test",
};
const catalogReport = {
  candidates: [{
    parent_sku: "NEW",
    parent: { product_title: "New bundle", variant_title: "Default", price: "10.00" },
    components: [
      { sku: "A", product_title: "Part A", variant_title: "Default", price: "8.00" },
      { sku: "B", product_title: "Part B", variant_title: "Default", price: "4.00" },
    ],
  }],
};
const readinessReport = {
  batch_id: "batch-v1",
  records: [{
    parent_sku: "NEW",
    status: "ready",
    evidence: {
      parent_price_cents: 1000,
      component_subtotal_cents: 1200,
      discount_cents: 200,
      allocation_total_cents: 1000,
      components: [
        { sku: "A", variant_price_cents: 800, allocated_price_cents: 667 },
        { sku: "B", variant_price_cents: 400, allocated_price_cents: 333 },
      ],
    },
  }],
};
const liveReadback = {
  batch_id: "batch-v1",
  records: [{
    parent_sku: "NEW",
    status: "needs_review",
    parent: { live: { product_gid: "gid://shopify/Product/1", variant_gid: "gid://shopify/ProductVariant/1" } },
    components: [
      { sku: "A", live: { product_gid: "gid://shopify/Product/2", variant_gid: "gid://shopify/ProductVariant/2" } },
      { sku: "B", live: { product_gid: "gid://shopify/Product/3", variant_gid: "gid://shopify/ProductVariant/3" } },
    ],
  }],
};

describe("development catalogue technical batch drafts", () => {
  it("builds deterministic valid local drafts and isolates existing bindings", () => {
    const first = prepareDevCatalogTechnicalBatchDrafts({ catalogReport, readinessReport, liveReadback, scope });
    const second = prepareDevCatalogTechnicalBatchDrafts({ catalogReport, readinessReport, liveReadback, scope });
    expect(first).toEqual(second);
    expect(first.summary).toEqual({ total: 2, draft_ready: 1, existing_binding: 1, blocked: 0 });
    expect(validateBundleConfig(first.records[0].draft.revision.configuration)).toEqual([]);
    expect(first.records[0].draft.revision.configuration.pricing.price_evidence).toMatchObject({
      bundle_price_cents: 1000,
      allocation_total_cents: 1000,
    });
    expect(first.records[0].draft.compile_preview.component_count).toBe(2);
    expect(first.shopify_writes_performed).toBe(false);
    expect(first.records[1]).toMatchObject({ parent_sku: "EXISTING", status: "existing_binding", draft: null });
  });

  it("fails closed when local or live evidence is blocked", () => {
    const blockedReadiness = structuredClone(readinessReport);
    blockedReadiness.records[0].status = "blocked";
    const result = prepareDevCatalogTechnicalBatchDrafts({ catalogReport, readinessReport: blockedReadiness, liveReadback, scope });
    expect(result.records[0]).toMatchObject({ status: "blocked", issues: ["LOCAL_READINESS_BLOCKED"] });
    expect(result.summary.blocked).toBe(1);
  });

  it("rejects mismatched evidence batches", () => {
    expect(() => prepareDevCatalogTechnicalBatchDrafts({
      catalogReport,
      readinessReport: { ...readinessReport, batch_id: "other" },
      liveReadback,
      scope,
    })).toThrow("technical batch evidence does not match scope");
  });
});
