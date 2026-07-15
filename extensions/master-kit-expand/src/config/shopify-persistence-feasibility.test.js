import { describe, expect, it } from "vitest";
import {
  SHOPIFY_PERSISTENCE_FEASIBILITY_V1,
  validateShopifyPersistenceFeasibility,
} from "./shopify-persistence-feasibility.js";

describe("Shopify persistence feasibility", () => {
  it("documents a local-only plan with product Snapshot storage and metafield CAS", () => {
    expect(validateShopifyPersistenceFeasibility()).toEqual([]);
    expect(SHOPIFY_PERSISTENCE_FEASIBILITY_V1.runtimeSnapshot.recommended)
      .toBe("parent_product_app_owned_json_metafield");
    expect(SHOPIFY_PERSISTENCE_FEASIBILITY_V1.capabilities.metafieldsSet.compare_and_set).toBe(true);
  });

  it("rejects unsupported transactional assumptions", () => {
    expect(validateShopifyPersistenceFeasibility({
      ...SHOPIFY_PERSISTENCE_FEASIBILITY_V1,
      capabilities: { ...SHOPIFY_PERSISTENCE_FEASIBILITY_V1.capabilities, cross_resource_transaction: true },
    })).toContain("Shopify cross-resource transaction support must not be assumed");
  });
});
