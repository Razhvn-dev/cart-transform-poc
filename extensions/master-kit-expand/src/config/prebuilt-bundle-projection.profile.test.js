import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertProfileAppConfigAllowed,
  extDir,
  resolveProfile,
} from "../../../../scripts/function-profile.mjs";
import { run as runProduction } from "../run.js";

describe("pre-built projection profile isolation", () => {
  it("is allowed only for the development app configs", () => {
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-projection-candidate",
      "shopify.app.dev.toml",
    )).not.toThrow();
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-projection-candidate",
      "shopify.app.local.toml",
    )).not.toThrow();
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-projection-candidate",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=prebuilt-projection-candidate/);
  });

  it("uses only the compact projection query", () => {
    const profile = resolveProfile("prebuilt-projection-candidate");
    const query = readFileSync(resolve(extDir, profile.query), "utf8");
    expect(profile.entry).toBe("src/run.dev.prebuilt-projection-candidate.js");
    expect(query).toContain("prebuiltExpandProjectionMetafield");
    expect(query).toContain("amountPerQuantity");
    expect(query).not.toContain("prebuiltRuntimeMappingMetafield");
    expect(query).not.toContain("prebuiltRuntimeSnapshotMetafield");
  });

  it("registers a development-only observable Projection diagnostic profile", () => {
    const profile = resolveProfile("prebuilt-projection-diagnostic-static-probe");

    expect(profile).toEqual(expect.objectContaining({
      entry: "src/run.dev.prebuilt-projection-diagnostic-static-probe.js",
      query: "src/queries/run.dev.prebuilt-projection.graphql",
    }));
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-projection-diagnostic-static-probe",
      "shopify.app.dev.toml",
    )).not.toThrow();
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-projection-diagnostic-static-probe",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=prebuilt-projection-diagnostic-static-probe/);
    expect(existsSync(resolve(extDir, profile.entry))).toBe(true);
    expect(readFileSync(resolve(extDir, "src/run.js"), "utf8"))
      .not.toContain("prebuilt-projection-diagnostic-static-probe");
  });

  it("registers a dev-only Projection promotion-bypass bisect profile", () => {
    const profile = resolveProfile("prebuilt-projection-promotion-bypass-bisect");

    expect(profile).toEqual(expect.objectContaining({
      entry: "src/run.dev.prebuilt-projection-promotion-bypass-bisect.js",
      query: "src/queries/run.dev.prebuilt-projection.graphql",
    }));
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-projection-promotion-bypass-bisect",
      "shopify.app.dev.toml",
    )).not.toThrow();
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-projection-promotion-bypass-bisect",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=prebuilt-projection-promotion-bypass-bisect/);
    expect(existsSync(resolve(extDir, profile.entry))).toBe(true);
  });

  it("does not change the production entry behavior", () => {
    expect(runProduction({ cart: { lines: [] } })).toEqual({ operations: [] });
    const productionEntry = readFileSync(resolve(extDir, "src/run.js"), "utf8");
    expect(productionEntry).not.toContain("prebuilt-projection");
    expect(productionEntry).not.toContain("prebuiltExpandProjectionMetafield");
  });
});
