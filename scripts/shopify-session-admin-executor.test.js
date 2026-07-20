import { describe, expect, it, vi } from "vitest";
import { createShopifySessionAdminExecutor } from "./shopify-session-admin-executor.js";

describe("Shopify Session Admin executor", () => {
  it("uses only the matching offline session without exposing its token", async () => {
    const prisma = { session: { findFirst: vi.fn(async () => ({ accessToken: "secret-token", expires: null })) } };
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" } } }) }));
    const execute = createShopifySessionAdminExecutor({
      prisma,
      shop: "huang-mvqquz1p.myshopify.com",
      apiVersion: "2026-04",
      fetchImpl,
    });
    await expect(execute("query { shop { id } }")).resolves.toMatchObject({ data: { shop: { id: expect.any(String) } } });
    expect(prisma.session.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { shop: "huang-mvqquz1p.myshopify.com", isOnline: false },
    }));
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://huang-mvqquz1p.myshopify.com/admin/api/2026-04/graphql.json",
      expect.objectContaining({ headers: expect.objectContaining({ "x-shopify-access-token": "secret-token" }) }),
    );
  });

  it("fails closed when no offline session is available", async () => {
    const execute = createShopifySessionAdminExecutor({
      prisma: { session: { findFirst: vi.fn(async () => null) } },
      shop: "huang-mvqquz1p.myshopify.com",
      apiVersion: "2026-04",
      fetchImpl: vi.fn(),
    });
    await expect(execute("query { shop { id } }")).rejects.toThrow("no offline Shopify Admin session");
  });

  it("rotates an expired offline token and persists the new token pair before use", async () => {
    const prisma = { session: {
      findFirst: vi.fn(async () => ({
        id: "offline_shop",
        accessToken: "expired-token",
        expires: new Date(Date.now() - 1_000),
        refreshToken: "refresh-token",
        refreshTokenExpires: new Date(Date.now() + 60_000),
      })),
      update: vi.fn(async () => ({})),
    } };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({
        access_token: "new-token",
        expires_in: 3600,
        refresh_token: "new-refresh-token",
        refresh_token_expires_in: 7776000,
        scope: "write_products",
      }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { shop: { id: "shop" } } }) });
    const execute = createShopifySessionAdminExecutor({
      prisma,
      shop: "huang-mvqquz1p.myshopify.com",
      apiVersion: "2026-04",
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl,
    });
    await execute("query { shop { id } }");
    expect(prisma.session.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "offline_shop" },
      data: expect.objectContaining({ accessToken: "new-token", refreshToken: "new-refresh-token" }),
    }));
    expect(fetchImpl.mock.calls[1][1].headers["x-shopify-access-token"]).toBe("new-token");
  });
});
