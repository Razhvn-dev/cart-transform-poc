import { describe, expect, it } from "vitest";

import { resolveDevShopifySessionCredentials } from "./dev-shopify-session-credentials.js";

describe("development Shopify session credentials", () => {
  it("returns only the locked development client identity", () => {
    expect(resolveDevShopifySessionCredentials({
      expectedClientId: "dev-client",
      clientId: "dev-client",
      clientSecret: "dev-secret",
    })).toEqual({ clientId: "dev-client", clientSecret: "dev-secret" });
  });

  it("rejects credentials for another app", () => {
    expect(() => resolveDevShopifySessionCredentials({
      expectedClientId: "dev-client",
      clientId: "production-client",
      clientSecret: "secret",
    })).toThrow("credentials do not belong to the locked development app");
  });

  it("allows an active offline session to run without a refresh secret", () => {
    expect(resolveDevShopifySessionCredentials({
      expectedClientId: "dev-client",
      clientId: "dev-client",
      clientSecret: " ",
    })).toEqual({ clientId: "dev-client", clientSecret: undefined });
  });
});
