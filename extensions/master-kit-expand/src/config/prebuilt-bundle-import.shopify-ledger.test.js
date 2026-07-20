import { describe, expect, it, vi } from "vitest";
import { createShopifyPrebuiltBundleImportLedger } from "./prebuilt-bundle-import.shopify-ledger.js";

describe("Shopify pre-built bundle import ledger", () => {
  it("exposes only the persistence-backed read and write contract", async () => {
    const persistence = {
      readPrebuiltImportLedger: vi.fn(async () => ({ state: "pending" })),
      writePrebuiltImportLedger: vi.fn(async (record) => record),
    };
    const ledger = createShopifyPrebuiltBundleImportLedger({ persistence });
    await expect(ledger.read("source-1")).resolves.toEqual({ state: "pending" });
    await expect(ledger.write({ source_identity: "source-1" })).resolves.toEqual({ source_identity: "source-1" });
    expect(persistence.readPrebuiltImportLedger).toHaveBeenCalledWith("source-1");
  });

  it("fails closed without both CAS persistence methods", () => {
    expect(() => createShopifyPrebuiltBundleImportLedger({ persistence: {} }))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_CAPABILITY" }));
  });
});
