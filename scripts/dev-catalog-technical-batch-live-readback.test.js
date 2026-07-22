import { describe, expect, it } from "vitest";

import { assessDevCatalogTechnicalBatchLiveReadback, collectTechnicalBatchSkus } from "./dev-catalog-technical-batch-live-readback.js";

const catalogReport = {
  candidates: [{
    parent_sku: "PARENT",
    parent: { sku: "PARENT", price: "10.00" },
    components: [{ sku: "PART", price: "12.00" }],
  }],
};
const scope = { batch_id: "batch", parent_skus: ["PARENT"] };
const liveVariants = [
  liveVariant("PARENT", "1", "10.00", "https://example.test/products/parent"),
  liveVariant("PART", "2", "12.00", null),
];

describe("development catalogue technical batch live readback", () => {
  it("collects exact parent and component SKUs", () => {
    expect(collectTechnicalBatchSkus(catalogReport, scope)).toEqual(["PARENT", "PART"]);
  });

  it("accepts unique active exact-price variants", () => {
    const report = assessDevCatalogTechnicalBatchLiveReadback({ catalogReport, scope, liveVariants });
    expect(report.summary).toEqual({ total: 1, ready_for_binding: 1, needs_review: 0, blocked: 0 });
    expect(report.shopify_writes_performed).toBe(false);
  });

  it("reports price drift and parent publication as review evidence", () => {
    const variants = structuredClone(liveVariants);
    variants[0].price = "9.99";
    variants[0].product.onlineStoreUrl = null;
    const report = assessDevCatalogTechnicalBatchLiveReadback({ catalogReport, scope, liveVariants: variants });
    expect(report.summary.needs_review).toBe(1);
    expect(report.records[0].issues.map((item) => item.code)).toEqual(["LIVE_PRICE_DRIFT", "PARENT_NOT_ONLINE_STORE"]);
  });

  it("reports exact acceptance inventory requirements without treating them as identity blockers", () => {
    const variants = structuredClone(liveVariants);
    variants[0].sellableOnlineQuantity = 0;
    variants[0].inventoryItem.inventoryLevel.quantities = [{ name: "available", quantity: 0 }, { name: "on_hand", quantity: 0 }];
    variants[1].sellableOnlineQuantity = 0;
    variants[1].inventoryItem.inventoryLevel.quantities = [{ name: "available", quantity: 0 }, { name: "on_hand", quantity: 0 }];
    const report = assessDevCatalogTechnicalBatchLiveReadback({ catalogReport, scope, liveVariants: variants });

    expect(report.summary.needs_review).toBe(1);
    expect(report.records[0].issues.map((item) => item.code)).toEqual([
      "PARENT_ACCEPTANCE_INVENTORY_REQUIRED",
      "COMPONENT_ACCEPTANCE_INVENTORY_REQUIRED",
    ]);
    expect(report.records[0].components[0].live).toMatchObject({ inventory_available: 0, inventory_on_hand: 0 });
  });

  it("fails closed for missing, ambiguous, or inactive variants", () => {
    const variants = [liveVariants[0], structuredClone(liveVariants[0])];
    variants[0].product.status = "DRAFT";
    const report = assessDevCatalogTechnicalBatchLiveReadback({ catalogReport, scope, liveVariants: variants });
    expect(report.summary.blocked).toBe(1);
    expect(report.records[0].issues.map((item) => item.code)).toEqual([
      "LIVE_VARIANT_AMBIGUOUS",
      "LIVE_VARIANT_NOT_FOUND",
    ]);
  });
});

function liveVariant(sku, id, price, onlineStoreUrl) {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    sku,
    price,
    compareAtPrice: null,
    sellableOnlineQuantity: 5,
    inventoryPolicy: "DENY",
    inventoryItem: {
      id: `gid://shopify/InventoryItem/${id}`,
      tracked: true,
      inventoryLevel: { quantities: [{ name: "available", quantity: 5 }, { name: "on_hand", quantity: 5 }] },
    },
    product: { id: `gid://shopify/Product/${id}`, handle: sku.toLowerCase(), status: "ACTIVE", onlineStoreUrl },
  };
}
