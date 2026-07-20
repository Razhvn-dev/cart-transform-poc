import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertProfileAppConfigAllowed,
  extDir,
  restoreProductionFunctionProfile,
  stageFunctionProfileForDeployment,
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
    ["pre-built observe profile + shopify.app.dev.toml", "prebuilt-observe", "shopify.app.dev.toml"],
    ["pre-built resolve observe profile + shopify.app.dev.toml", "prebuilt-resolve-observe", "shopify.app.dev.toml"],
    ["pre-built candidate profile + shopify.app.dev.toml", "prebuilt-candidate", "shopify.app.dev.toml"],
    ["pre-built static probe profile + shopify.app.dev.toml", "prebuilt-static-probe", "shopify.app.dev.toml"],
    ["pre-built query static probe profile + shopify.app.dev.toml", "prebuilt-query-static-probe", "shopify.app.dev.toml"],
    ["pre-built parse static probe profile + shopify.app.dev.toml", "prebuilt-parse-static-probe", "shopify.app.dev.toml"],
    ["pre-built candidate-build static probe profile + shopify.app.dev.toml", "prebuilt-candidate-build-static-probe", "shopify.app.dev.toml"],
    ["pre-built candidate-import static probe profile + shopify.app.dev.toml", "prebuilt-candidate-import-static-probe", "shopify.app.dev.toml"],
    ["pre-built metadata lookup static probe profile + shopify.app.dev.toml", "prebuilt-metadata-lookup-static-probe", "shopify.app.dev.toml"],
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

  it("rejects the pre-built observe profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-observe",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=prebuilt-observe/);
  });

  it("rejects the pre-built resolve observe profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-resolve-observe",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=prebuilt-resolve-observe/);
  });

  it("rejects the pre-built candidate profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-candidate",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=prebuilt-candidate/);
  });

  it("rejects the pre-built static probe profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-static-probe",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=prebuilt-static-probe/);
  });

  it("rejects the pre-built query static probe profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-query-static-probe",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=prebuilt-query-static-probe/);
  });

  it("rejects the pre-built parse static probe profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-parse-static-probe",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=prebuilt-parse-static-probe/);
  });

  it("rejects the pre-built candidate-build static probe profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-candidate-build-static-probe",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=prebuilt-candidate-build-static-probe/);
  });

  it("rejects the pre-built candidate-import static probe profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-candidate-import-static-probe",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=prebuilt-candidate-import-static-probe/);
  });

  it("rejects the pre-built metadata lookup static probe profile with the Custom Distribution App config", () => {
    expect(() => assertProfileAppConfigAllowed(
      "prebuilt-metadata-lookup-static-probe",
      "shopify.app.toml",
    )).toThrow(/Refusing FUNCTION_PROFILE=prebuilt-metadata-lookup-static-probe/);
  });

  it("uses the isolated pre-built query during candidate-build static probing", async () => {
    await withTemporaryFunctionProfile(
      "prebuilt-candidate-build-static-probe",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expect(activeQueryText()).toContain("prebuiltRuntimeMappingMetafield");
        expect(activeQueryText()).toContain("prebuiltRuntimeSnapshotMetafield");
      },
    );

    expectActiveQueryProductionClean();
  });

  it("uses the production-clean query during the pre-built static probe", async () => {
    await withTemporaryFunctionProfile(
      "prebuilt-static-probe",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expectActiveQueryProductionClean();
      },
    );

    expectActiveQueryProductionClean();
  });

  it("uses the pre-built metafield query only during the query static probe", async () => {
    await withTemporaryFunctionProfile(
      "prebuilt-query-static-probe",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expect(activeQueryText()).toContain("prebuiltRuntimeMappingMetafield");
        expect(activeQueryText()).toContain("prebuiltRuntimeSnapshotMetafield");
      },
    );

    expectActiveQueryProductionClean();
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

  it("uses the isolated pre-built observe query only during pre-built observe profile work", async () => {
    await withTemporaryFunctionProfile(
      "prebuilt-observe",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expect(activeQueryText()).toContain("prebuilt_bundle_runtime_mapping_v1");
        expect(activeQueryText()).toContain("prebuiltRuntimeMappingMetafield");
      },
    );

    expectActiveQueryProductionClean();
  });

  it("uses the same isolated query during pre-built resolution observation", async () => {
    await withTemporaryFunctionProfile(
      "prebuilt-resolve-observe",
      { appConfig: "shopify.app.dev.toml" },
      async () => {
        expect(activeQueryText()).toContain("prebuiltRuntimeSnapshotMetafield");
      },
    );

    expectActiveQueryProductionClean();
  });

  it("stages the matching pre-built candidate query for no-build deployment packaging", () => {
    try {
      const profile = stageFunctionProfileForDeployment(
        "prebuilt-candidate",
        { appConfig: "shopify.app.dev.toml" },
      );

      expect(profile.entry).toBe("src/run.dev.prebuilt-candidate.js");
      expect(activeQueryText()).toContain("prebuiltRuntimeMappingMetafield");
      expect(activeQueryText()).toContain("prebuiltRuntimeSnapshotMetafield");
    } finally {
      // withTemporaryFunctionProfile is intentionally not used here: staging
      // must survive until Shopify CLI has packaged the Function.
      restoreProductionFunctionProfile();
    }

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
