import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertProfileAppConfigAllowed,
  extDir,
  withTemporaryFunctionProfile,
} from "../../../../scripts/function-profile.mjs";

function activeQueryText() {
  return readFileSync(resolve(extDir, "src/run.graphql"), "utf8");
}

function expectActiveQueryProductionClean() {
  const text = activeQueryText();
  expect(text).not.toContain("aces_dev");
  expect(text).not.toContain("bundle_runtime_snapshot_test");
  expect(text).not.toContain("runtimeSnapshotDevMetafield");
}

describe("Function profile deployment safety", () => {
  it.each([
    ["production profile + shopify.app.toml", "production", "shopify.app.toml"],
    ["production profile + shopify.app.dev.toml", "production", "shopify.app.dev.toml"],
    ["dev profile + shopify.app.dev.toml", "dev", "shopify.app.dev.toml"],
    ["dev profile + shopify.app.local.toml", "dev", "shopify.app.local.toml"],
    ["Stage 2 profile + shopify.app.dev.toml", "bisect-stage-2", "shopify.app.dev.toml"],
    ["Stage 3 profile + shopify.app.dev.toml", "bisect-stage-3", "shopify.app.dev.toml"],
    ["Stage 4 profile + shopify.app.dev.toml", "bisect-stage-4", "shopify.app.dev.toml"],
    ["Stage 5 profile + shopify.app.dev.toml", "bisect-stage-5", "shopify.app.dev.toml"],
    ["Stage 6 profile + shopify.app.dev.toml", "bisect-stage-6", "shopify.app.dev.toml"],
    ["Stage 7 profile + shopify.app.dev.toml", "bisect-stage-7", "shopify.app.dev.toml"],
    ["Stage 8 profile + shopify.app.dev.toml", "bisect-stage-8", "shopify.app.dev.toml"],
  ])("allows %s", (_name, profile, appConfig) => {
    expect(() => assertProfileAppConfigAllowed(profile, appConfig)).not.toThrow();
  });

  it.each([
    ["dev profile + shopify.app.toml", "shopify.app.toml"],
    ["dev profile + Custom Distribution App client ID", "shopify.app.toml"],
  ])("rejects %s", (_name, appConfig) => {
    expect(() => assertProfileAppConfigAllowed("dev", appConfig)).toThrow(
      /Refusing FUNCTION_PROFILE=dev/,
    );
  });

  it("rejects dev profile without explicit app config", () => {
    expect(() => assertProfileAppConfigAllowed("dev", null)).toThrow(
      /requires SHOPIFY_APP_CONFIG/,
    );
  });

  it("rejects the Stage 2 profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "bisect-stage-2",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=bisect-stage-2/);
  });

  it("rejects the Stage 3 profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "bisect-stage-3",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=bisect-stage-3/);
  });

  it("rejects the Stage 4 profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "bisect-stage-4",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=bisect-stage-4/);
  });

  it("rejects the Stage 5 profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "bisect-stage-5",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=bisect-stage-5/);
  });

  it("rejects the Stage 6 profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "bisect-stage-6",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=bisect-stage-6/);
  });

  it("rejects the Stage 7 profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "bisect-stage-7",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=bisect-stage-7/);
  });

  it("rejects the Stage 8 profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "bisect-stage-8",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=bisect-stage-8/);
  });

  it("keeps the production query active during Stage 2 profile work", async () => {
    await withTemporaryFunctionProfile(
      "bisect-stage-2",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expectActiveQueryProductionClean();
      },
    );

    expectActiveQueryProductionClean();
  });

  it("uses the dev query only during Stage 3 profile work", async () => {
    await withTemporaryFunctionProfile(
      "bisect-stage-3",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expect(activeQueryText()).toContain("aces_dev");
        expect(activeQueryText()).toContain("runtimeSnapshotDevMetafield");
      },
    );

    expectActiveQueryProductionClean();
  });

  it("uses the dev query only during Stage 4 profile work", async () => {
    await withTemporaryFunctionProfile(
      "bisect-stage-4",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expect(activeQueryText()).toContain("aces_dev");
        expect(activeQueryText()).toContain("runtimeSnapshotDevMetafield");
      },
    );

    expectActiveQueryProductionClean();
  });

  it("uses the dev query only during Stage 5 profile work", async () => {
    await withTemporaryFunctionProfile(
      "bisect-stage-5",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expect(activeQueryText()).toContain("aces_dev");
        expect(activeQueryText()).toContain("runtimeSnapshotDevMetafield");
      },
    );

    expectActiveQueryProductionClean();
  });

  it("uses the dev query only during Stage 6 profile work", async () => {
    await withTemporaryFunctionProfile(
      "bisect-stage-6",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expect(activeQueryText()).toContain("aces_dev");
        expect(activeQueryText()).toContain("runtimeSnapshotDevMetafield");
      },
    );

    expectActiveQueryProductionClean();
  });

  it("uses the dev query only during Stage 7 profile work", async () => {
    await withTemporaryFunctionProfile(
      "bisect-stage-7",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expect(activeQueryText()).toContain("aces_dev");
        expect(activeQueryText()).toContain("runtimeSnapshotDevMetafield");
      },
    );

    expectActiveQueryProductionClean();
  });

  it("uses the dev query only during Stage 8 profile work", async () => {
    await withTemporaryFunctionProfile(
      "bisect-stage-8",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expect(activeQueryText()).toContain("aces_dev");
        expect(activeQueryText()).toContain("runtimeSnapshotDevMetafield");
      },
    );

    expectActiveQueryProductionClean();
  });

  it("restores production query after successful dev profile work", async () => {
    await withTemporaryFunctionProfile(
      "dev",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expect(activeQueryText()).toContain("aces_dev");
      },
    );

    expectActiveQueryProductionClean();
  });

  it("restores production query after failed dev profile work", async () => {
    await expect(withTemporaryFunctionProfile(
      "dev",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expect(activeQueryText()).toContain("aces_dev");
        throw new Error("intentional dev profile failure");
      },
    )).rejects.toThrow("intentional dev profile failure");

    expectActiveQueryProductionClean();
  });
});
