import { describe, expect, it, vi } from "vitest";

import {
  ShopifyCliTransportError,
  createShopifyCliReadSafeExecutor,
  isReadOnlyGraphql,
  isTransientShopifyCliTransportError,
} from "./shopify-cli-read-safe-executor.js";

const target = { appConfig: "shopify.app.dev.toml", store: "huang-mvqquz1p.myshopify.com", apiVersion: "2026-04" };

function createExecutor({ execFileAsync, readFileImpl = vi.fn().mockResolvedValue('{"data":{"shop":{"name":"ACES"}}}'), wait = vi.fn().mockResolvedValue(undefined) } = {}) {
  return createShopifyCliReadSafeExecutor({
    cliEntrypoint: "C:/shopify/run.js",
    directory: "C:/temp/rehearsal",
    execFileAsync,
    root: "C:/project",
    target,
    readFileImpl,
    wait,
  });
}

describe("Shopify CLI read-safe executor", () => {
  it("recognizes only query operations as retryable reads", () => {
    expect(isReadOnlyGraphql("#graphql\nquery Read { shop { name } }")).toBe(true);
    expect(isReadOnlyGraphql("mutation Write { metafieldsSet(metafields: []) { userErrors { message } } }")).toBe(false);
    expect(isReadOnlyGraphql("query Misleading { value: __typename } mutation Unsafe { shop { name } }")).toBe(false);
  });

  it("retries a transient read once and returns the later response", async () => {
    const execFileAsync = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { stderr: "socket hang up" }))
      .mockResolvedValueOnce({});
    const backoff = vi.fn().mockResolvedValue(undefined);
    const execute = createExecutor({ execFileAsync, wait: backoff });

    await expect(execute("query Reconcile { shop { name } }")).resolves.toEqual({ data: { shop: { name: "ACES" } } });
    expect(execFileAsync).toHaveBeenCalledTimes(2);
    expect(backoff).toHaveBeenCalledWith(250);
  });

  it("never retries a mutation after a transport failure", async () => {
    const execFileAsync = vi.fn().mockRejectedValue(Object.assign(new Error("socket hang up"), { stderr: "socket hang up" }));
    const execute = createExecutor({ execFileAsync });

    await expect(execute("mutation Write { metafieldsSet(metafields: []) { userErrors { message } } }")).rejects.toMatchObject({
      name: "ShopifyCliTransportError",
      operationKind: "mutation",
      attempts: 1,
    });
    expect(execFileAsync).toHaveBeenCalledTimes(1);
  });

  it("fails a read after the bounded retry budget without treating it as a mutation", async () => {
    const execFileAsync = vi.fn().mockRejectedValue(Object.assign(new Error("Client network socket disconnected before secure TLS connection was established"), { stderr: "ECONNRESET" }));
    const execute = createExecutor({ execFileAsync });

    await expect(execute("query Reconcile { shop { name } }")).rejects.toBeInstanceOf(ShopifyCliTransportError);
    expect(execFileAsync).toHaveBeenCalledTimes(2);
  });

  it("retries Shopify CLI request-aborted reads within the bounded budget", async () => {
    const execFileAsync = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("The user aborted a request."), { stderr: "The user aborted a request." }))
      .mockResolvedValueOnce({});
    const execute = createExecutor({ execFileAsync });

    await expect(execute("query Reconcile { shop { name } }")).resolves.toEqual({ data: { shop: { name: "ACES" } } });
    expect(execFileAsync).toHaveBeenCalledTimes(2);
  });

  it("retries an OAuth token transport failure with an empty reason", async () => {
    const oauthFailure = [
      "request to https://huang-mvqquz1p.myshopify.com/admin/oauth/access_token",
      "failed, reason:",
    ].join(" ");
    const execFileAsync = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("CLI failed"), {
        stderr: oauthFailure,
      }))
      .mockResolvedValueOnce({});
    const backoff = vi.fn().mockResolvedValue(undefined);
    const execute = createExecutor({ execFileAsync, wait: backoff });

    await expect(execute("query Reconcile { shop { name } }")).resolves.toEqual({
      data: { shop: { name: "ACES" } },
    });
    expect(execFileAsync).toHaveBeenCalledTimes(2);
    expect(backoff).toHaveBeenCalledWith(250);
  });

  it("reports the actual attempt count when a read fails with a deterministic error", async () => {
    const execFileAsync = vi.fn().mockRejectedValue(new Error("Access denied for publications field"));
    const execute = createExecutor({ execFileAsync });

    await expect(execute("query Reconcile { shop { name } }")).rejects.toMatchObject({
      name: "ShopifyCliTransportError",
      operationKind: "read_only",
      attempts: 1,
      message: "Shopify CLI read-only request failed after 1 attempts; no mutation was sent",
    });
    expect(execFileAsync).toHaveBeenCalledTimes(1);
  });

  it("classifies only known transient transport failures for retries", () => {
    expect(isTransientShopifyCliTransportError(new Error("socket hang up"))).toBe(true);
    expect(isTransientShopifyCliTransportError(new Error("The user aborted a request."))).toBe(true);
    expect(isTransientShopifyCliTransportError(Object.assign(new Error("CLI failed"), {
      stderr: "│ Client network socket disconnected before secure TLS │\n│ connection was established │",
    }))).toBe(true);
    expect(isTransientShopifyCliTransportError(new Error("Shopify Admin GraphQL returned no data"))).toBe(false);
  });
});
