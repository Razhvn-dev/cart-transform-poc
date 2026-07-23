import { describe, expect, it, vi } from "vitest";
import { createShopifySessionAdminExecutor } from "./shopify-session-admin-executor.js";

describe("Shopify Session Admin executor", () => {
  it.each([
    ["read", "query { shop { id } }"],
    ["write", "mutation { metafieldsSet(metafields: []) { userErrors { message } } }"],
  ])("rejects %s operations before reading an app-unbound offline session", async (_label, query) => {
    const findFirst = vi.fn();
    const update = vi.fn();
    const fetchImpl = vi.fn();
    const execute = createShopifySessionAdminExecutor({
      prisma: { session: { findFirst, update } },
      shop: "huang-mvqquz1p.myshopify.com",
      apiVersion: "2026-04",
      clientId: "untrusted-caller-constant",
      clientSecret: "unused",
      fetchImpl,
    });

    await expect(execute(query)).rejects.toThrow(/session transport.*disabled.*app identity/i);
    expect(findFirst).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
