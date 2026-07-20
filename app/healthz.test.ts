import { describe, expect, it } from "vitest";
import { loader } from "./routes/healthz";

describe("GET /healthz", () => {
  it("returns a no-store service readiness response without a Shopify session", async () => {
    const response = await loader({
      request: new Request("https://example.test/healthz"),
      context: {},
      params: {},
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, service: "cart-transform-poc" });
  });
});
