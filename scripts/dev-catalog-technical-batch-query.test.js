import { describe, expect, it, vi } from "vitest";

import { executeDevCatalogTechnicalBatchQuery } from "./dev-catalog-technical-batch-query.js";

describe("development catalogue technical batch query", () => {
  it("uses the complete inventory query when the session has access", async () => {
    const execute = vi.fn(async () => ({ data: { productVariants: { nodes: [{ sku: "PARENT" }] } } }));
    await expect(executeDevCatalogTechnicalBatchQuery({ execute, queryText: "sku:PARENT", locationId: "location" }))
      .resolves.toEqual({ nodes: [{ sku: "PARENT" }], inventory_readback: "available" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("falls back to catalogue-only fields for an explicit read_inventory scope error", async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error("Required access: `read_inventory` access scope."))
      .mockResolvedValueOnce({ data: { productVariants: { nodes: [{ sku: "PARENT" }] } } });
    await expect(executeDevCatalogTechnicalBatchQuery({ execute, queryText: "sku:PARENT", locationId: "location" }))
      .resolves.toEqual({ nodes: [{ sku: "PARENT" }], inventory_readback: "unavailable_scope" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not hide unrelated Shopify failures", async () => {
    const error = new Error("Shopify transport failed");
    const execute = vi.fn(async () => { throw error; });
    await expect(executeDevCatalogTechnicalBatchQuery({ execute, queryText: "sku:PARENT", locationId: "location" }))
      .rejects.toBe(error);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
