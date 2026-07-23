import { describe, expect, it, vi } from "vitest";
import {
  createShopifyPrebuiltBundleImportLedger,
  createShopifyPrebuiltBundleImportLedgerReader,
} from "./prebuilt-bundle-import.shopify-ledger.js";

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

  it("exposes a frozen read-only ledger view without requiring or exposing writes", async () => {
    const persistence = {
      readPrebuiltImportLedger: vi.fn(async () => ({ state: "completed" })),
      readPrebuiltImportLedgers: vi.fn(async () => [{ state: "completed" }, null]),
      writePrebuiltImportLedger: vi.fn(),
    };

    const reader = createShopifyPrebuiltBundleImportLedgerReader({ persistence });

    await expect(reader.read("source-1")).resolves.toEqual({ state: "completed" });
    await expect(reader.readMany(["source-1", "source-2"])).resolves.toEqual([{ state: "completed" }, null]);
    expect(persistence.readPrebuiltImportLedgers).toHaveBeenCalledWith(["source-1", "source-2"]);
    expect(reader.write).toBeUndefined();
    expect(Object.isFrozen(reader)).toBe(true);
    expect(persistence.writePrebuiltImportLedger).not.toHaveBeenCalled();
  });

  it("fails closed when persistence cannot read the import ledger", () => {
    expect(() => createShopifyPrebuiltBundleImportLedgerReader({ persistence: {} }))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_CAPABILITY" }));
  });

  it("keeps readMany optional when persistence only supports single read", () => {
    const reader = createShopifyPrebuiltBundleImportLedgerReader({
      persistence: { readPrebuiltImportLedger: vi.fn() },
    });

    expect(reader.readMany).toBeUndefined();
    expect(reader.write).toBeUndefined();
  });
});
