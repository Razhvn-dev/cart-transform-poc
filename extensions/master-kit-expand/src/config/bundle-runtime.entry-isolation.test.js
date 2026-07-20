import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run as runDev } from "../run.dev.js";
import { run as runStage2 } from "../run.dev.stage2.js";
import { run as runStage3 } from "../run.dev.stage3.js";
import { run as runStage4 } from "../run.dev.stage4.js";
import { run as runStage5 } from "../run.dev.stage5.js";
import { run as runStage6 } from "../run.dev.stage6.js";
import { run as runStage7 } from "../run.dev.stage7.js";
import { run as runStage8 } from "../run.dev.stage8.js";
import { run as runPrebuiltObserve } from "../run.dev.prebuilt-observe.js";
import { run as runPrebuiltResolveObserve } from "../run.dev.prebuilt-resolve-observe.js";
import { run as runPrebuiltCandidate } from "../run.dev.prebuilt-candidate.js";
import { run as runPrebuiltStaticProbe } from "../run.dev.prebuilt-static-probe.js";
import { run as runPrebuiltParseStaticProbe } from "../run.dev.prebuilt-parse-static-probe.js";
import { run as runPrebuiltCandidateBuildStaticProbe } from "../run.dev.prebuilt-candidate-build-static-probe.js";
import { run as runPrebuiltCandidateImportStaticProbe } from "../run.dev.prebuilt-candidate-import-static-probe.js";
import { run as runPrebuiltMetadataLookupStaticProbe } from "../run.dev.prebuilt-metadata-lookup-static-probe.js";
import { run as runProduction } from "../run.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MASTER_KIT_VARIANT_ID = "gid://shopify/ProductVariant/51505325605142";
const EFI_FUSION_LITE = "gid://shopify/ProductVariant/51552319766806";
const EFI_KILLSHOT_2_PRO = "gid://shopify/ProductVariant/51552319865110";
const FUEL_TEST = "gid://shopify/ProductVariant/51505348346134";
const FUEL_TEST_2 = "gid://shopify/ProductVariant/51518319591702";
const IGNITION_BLACK_JACK = "gid://shopify/ProductVariant/51552321011990";
const IGNITION_HIGH_ROLLER = "gid://shopify/ProductVariant/51552321110294";
const DISPLAY_8_HD = "gid://shopify/ProductVariant/51552322584854";
const PARENT_PRODUCT_GID = "gid://shopify/Product/10600519598358";

function attribute(value) {
  return { value };
}

function masterLine(attributes = {}) {
  return {
    id: "gid://shopify/CartLine/99",
    quantity: 1,
    merchandise: {
      __typename: "ProductVariant",
      id: MASTER_KIT_VARIANT_ID,
      product: {
        id: PARENT_PRODUCT_GID,
      },
    },
    ...attributes,
  };
}

function functionInput(attributes = {}) {
  return {
    cart: {
      lines: [masterLine(attributes)],
    },
  };
}

function source(path) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function expectNoDevTokens(text) {
  expect(text).not.toContain("aces_dev");
  expect(text).not.toContain("bundle_runtime_snapshot_test");
  expect(text).not.toContain("runtimeSnapshotDevMetafield");
  expect(text).not.toContain("bundle-runtime.dev-shadow");
  expect(text).not.toContain("bundle-runtime.shadow-comparison");
  expect(text).not.toContain("bundle-runtime.compiler");
  expect(text).not.toContain("bundle-runtime.validator");
  expect(text).not.toContain("bundle-runtime.resolver");
  expect(text).not.toContain("master-kit-config.v1");
  expect(text).not.toContain("prebuilt-bundle-import");
  expect(text).not.toContain("prebuilt-bundle-runtime");
  expect(text).not.toContain("prebuilt-bundle-cart-metadata");
  expect(text).not.toContain("prebuilt_bundle_runtime_assignment");
  expect(text).not.toContain("prebuilt Bundle runtime preparation");
  expect(text).not.toContain("buildPrebuiltBundleFunctionResult");
  expect(text).not.toContain("legacy-paid-app");
  expect(text).not.toContain("candidate");
}

describe("Cart Transform entry isolation", () => {
  it("keeps production entry and query free of dev-only shadow code", () => {
    const productionEntry = source("run.js");
    const activeQuery = source("run.graphql");
    const productionQuery = source("queries/run.production.graphql");
    const sharedCore = source("run.core.js");

    for (const text of [productionEntry, activeQuery, productionQuery, sharedCore]) {
      expectNoDevTokens(text);
    }
  });

  it("keeps generated production types and artifact free of candidate/shadow tokens when present", () => {
    const generatedTypes = resolve(ROOT, "../generated/api.ts");
    const productionArtifact = resolve(ROOT, "../dist/function.js");

    expectNoDevTokens(readFileSync(generatedTypes, "utf8"));
    if (existsSync(productionArtifact)) {
      expectNoDevTokens(readFileSync(productionArtifact, "utf8"));
    }
  });

  it("contains dev-only shadow query and import only in the dev path", () => {
    expect(source("run.dev.js")).toContain("bundle-runtime.dev-shadow");
    expect(source("run.dev.js")).toContain('DEPLOYED_DEV_RUNTIME_MODE = "candidate"');
    expect(source("queries/run.dev.graphql")).toContain("aces_dev");
    expect(source("queries/run.dev.graphql")).toContain(
      "bundle_runtime_snapshot_test",
    );
  });

  it("keeps the Stage 2 entry and artifact free of Snapshot/dev tokens", () => {
    expectNoDevTokens(source("run.dev.stage2.js"));

    const artifact = readFileSync(resolve(ROOT, "../dist/function.js"), "utf8");
    expectNoDevTokens(artifact);
  });

  it("uses the dev metafield input only in the Stage 3 query", () => {
    const stage3Entry = source("run.dev.stage3.js");
    const stage3Query = source("queries/run.dev.graphql");

    expect(stage3Entry).toBe(source("run.dev.stage2.js"));
    expect(stage3Entry).not.toContain("runtimeSnapshotDevMetafield");
    expect(stage3Query).toContain("runtimeSnapshotDevMetafield");
    expect(stage3Query).toContain('namespace: "aces_dev"');
    expect(stage3Query).toContain('key: "bundle_runtime_snapshot_test"');
    expect(stage3Query).toContain("jsonValue");
    expect(stage3Query).toContain("value");
  });

  it("keeps Stage 4 limited to Snapshot extraction and parsing", () => {
    const stage4Entry = source("run.dev.stage4.js");

    expect(stage4Entry).toContain("bundle-runtime.extraction");
    expect(stage4Entry).not.toContain("bundle-runtime.validator");
    expect(stage4Entry).not.toContain("bundle-runtime.resolver");
    expect(stage4Entry).not.toContain("bundle-runtime.shadow-comparison");
    expect(stage4Entry).not.toContain("bundle-runtime.dev-shadow");
    expect(stage4Entry).not.toContain("candidate");
  });

  it("keeps Stage 4 output identical when a Snapshot metafield is present", () => {
    const input = functionInput({
      builderEfiVariantId: attribute(EFI_FUSION_LITE),
      builderFuelVariantId: attribute(FUEL_TEST),
      builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
      merchandise: {
        __typename: "ProductVariant",
        id: MASTER_KIT_VARIANT_ID,
        product: {
          id: PARENT_PRODUCT_GID,
          runtimeSnapshotDevMetafield: {
            jsonValue: { snapshot_schema: "bundle_runtime.v1" },
          },
        },
      },
    });

    expect(JSON.stringify(runStage4(input)))
      .toBe(JSON.stringify(runProduction(input)));
  });

  it("keeps Stage 5 limited to Snapshot extraction and validation", () => {
    const stage5Entry = source("run.dev.stage5.js");

    expect(stage5Entry).toContain("bundle-runtime.validation-observation");
    expect(stage5Entry).not.toContain("bundle-runtime.resolver");
    expect(stage5Entry).not.toContain("bundle-runtime.shadow-comparison");
    expect(stage5Entry).not.toContain("bundle-runtime.dev-shadow");
    expect(stage5Entry).not.toContain("candidate");
  });

  it("keeps Stage 5 output identical when a Snapshot metafield is present", () => {
    const input = functionInput({
      builderEfiVariantId: attribute(EFI_FUSION_LITE),
      builderFuelVariantId: attribute(FUEL_TEST),
      builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
      merchandise: {
        __typename: "ProductVariant",
        id: MASTER_KIT_VARIANT_ID,
        product: {
          id: PARENT_PRODUCT_GID,
          runtimeSnapshotDevMetafield: {
            jsonValue: { snapshot_schema: "bundle_runtime.v1" },
          },
        },
      },
    });

    expect(JSON.stringify(runStage5(input)))
      .toBe(JSON.stringify(runProduction(input)));
  });

  it("keeps Stage 6 limited to Snapshot extraction, validation, and resolution", () => {
    const stage6Entry = source("run.dev.stage6.js");

    expect(stage6Entry).toContain("bundle-runtime.resolution-observation");
    expect(stage6Entry).not.toContain("bundle-runtime.shadow-comparison");
    expect(stage6Entry).not.toContain("bundle-runtime.dev-shadow");
    expect(stage6Entry).not.toContain("candidate");
  });

  it("keeps Stage 6 output identical when a Snapshot metafield is present", () => {
    const input = functionInput({
      builderEfiVariantId: attribute(EFI_FUSION_LITE),
      builderFuelVariantId: attribute(FUEL_TEST),
      builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
      merchandise: {
        __typename: "ProductVariant",
        id: MASTER_KIT_VARIANT_ID,
        product: {
          id: PARENT_PRODUCT_GID,
          runtimeSnapshotDevMetafield: {
            jsonValue: { snapshot_schema: "bundle_runtime.v1" },
          },
        },
      },
    });

    expect(JSON.stringify(runStage6(input)))
      .toBe(JSON.stringify(runProduction(input)));
  });

  it("keeps Stage 7 limited to Snapshot comparison observation", () => {
    const stage7Entry = source("run.dev.stage7.js");

    expect(stage7Entry).toContain("bundle-runtime.comparison-observation");
    expect(stage7Entry).toContain("bundle-runtime.resolution-observation");
    expect(stage7Entry).not.toContain("bundle-runtime.dev-shadow");
    expect(stage7Entry).not.toContain("candidate");
  });

  it("keeps Stage 7 output identical when a Snapshot metafield is present", () => {
    const input = functionInput({
      builderEfiVariantId: attribute(EFI_FUSION_LITE),
      builderFuelVariantId: attribute(FUEL_TEST),
      builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
      merchandise: {
        __typename: "ProductVariant",
        id: MASTER_KIT_VARIANT_ID,
        product: {
          id: PARENT_PRODUCT_GID,
          runtimeSnapshotDevMetafield: {
            jsonValue: { snapshot_schema: "bundle_runtime.v1" },
          },
        },
      },
    });

    expect(JSON.stringify(runStage7(input)))
      .toBe(JSON.stringify(runProduction(input)));
  });

  it("keeps Stage 8 isolated to candidate promotion", () => {
    const stage8Entry = source("run.dev.stage8.js");

    expect(stage8Entry).toContain("bundle-runtime.candidate-promotion");
    expect(stage8Entry).not.toContain("bundle-runtime.dev-shadow");
    expect(stage8Entry).not.toContain("bundle-runtime.shadow-comparison");
  });

  it("keeps the future pre-built Function-input composition out of every active entry", () => {
    const entries = [
      "run.js",
      "run.dev.js",
      "run.dev.stage2.js",
      "run.dev.stage3.js",
      "run.dev.stage4.js",
      "run.dev.stage5.js",
      "run.dev.stage6.js",
      "run.dev.stage7.js",
      "run.dev.stage8.js",
    ];

    entries.forEach((entry) => {
      expect(source(entry)).not.toContain("prebuilt-bundle-runtime.function-input");
      expect(source(entry)).not.toContain("prebuilt-bundle-runtime.function-candidate");
    });
  });

  it("keeps the pre-built observe entry limited to parsing and Shared Core output", () => {
    const entry = source("run.dev.prebuilt-observe.js");
    expect(entry).toContain("prebuilt-bundle-runtime.function-input");
    expect(entry).not.toContain("prebuilt-bundle-runtime.function-candidate");
    expect(entry).not.toContain("prebuilt-bundle-runtime.local-candidate");
  });

  it("keeps the pre-built resolve observe entry limited to candidate calculation and Shared Core output", () => {
    const entry = source("run.dev.prebuilt-resolve-observe.js");
    expect(entry).toContain("prebuilt-bundle-runtime.function-candidate");
    expect(entry).not.toContain("candidate.result");
    expect(entry).not.toContain("return buildPrebuilt");
  });

  it("keeps the final pre-built candidate entry dev-only and isolates its promotion helper", () => {
    const entry = source("run.dev.prebuilt-candidate.js");
    expect(entry).toContain("prebuilt-bundle-runtime.candidate-promotion");
    expect(entry).toContain("prebuilt-bundle-runtime.function-candidate");
    expect(source("run.js")).not.toContain("prebuilt-bundle-runtime.candidate-promotion");
  });

  it("keeps the static hosted probe dev-only and out of production entries", () => {
    const entry = source("run.dev.prebuilt-static-probe.js");
    expect(entry).toContain("PREBUILT_PARENT_VARIANT_GID");
    expect(entry).not.toContain("prebuiltRuntimeMappingMetafield");
    expect(source("run.js")).not.toContain("prebuilt-static-probe");
    expect(source("run.core.js")).not.toContain("51571819708694");

    const result = runPrebuiltStaticProbe({
      cart: {
        lines: [{
          id: "gid://shopify/CartLine/prebuilt-probe",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            id: "gid://shopify/ProductVariant/51571819708694",
            product: { id: "gid://shopify/Product/10627515777302" },
          },
        }],
      },
    });
    expect(result.operations).toHaveLength(1);
  });

  it("keeps the parse + static hosted probe isolated from production entries", () => {
    const entry = source("run.dev.prebuilt-parse-static-probe.js");
    expect(entry).toContain("extractPrebuiltBundleRuntimeFunctionInput");
    expect(entry).toContain("run.dev.prebuilt-static-probe");
    expect(source("run.js")).not.toContain("prebuilt-parse-static-probe");

    const result = runPrebuiltParseStaticProbe({
      cart: {
        lines: [{
          id: "gid://shopify/CartLine/prebuilt-parse-probe",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            id: "gid://shopify/ProductVariant/51571819708694",
            product: { id: "gid://shopify/Product/10627515777302" },
          },
        }],
      },
    });
    expect(result.operations).toHaveLength(1);
  });

  it("keeps the candidate-build + static hosted probe isolated from production entries", () => {
    const entry = source("run.dev.prebuilt-candidate-build-static-probe.js");
    expect(entry).toContain("buildPrebuiltBundleRuntimeFunctionCandidate");
    expect(entry).toContain("run.dev.prebuilt-static-probe");
    expect(source("run.js")).not.toContain("prebuilt-candidate-build-static-probe");

    const result = runPrebuiltCandidateBuildStaticProbe({
      cart: {
        lines: [{
          id: "gid://shopify/CartLine/prebuilt-candidate-build-probe",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            id: "gid://shopify/ProductVariant/51571819708694",
            product: {
              id: "gid://shopify/Product/10627515777302",
              prebuiltRuntimeMappingMetafield: null,
              prebuiltRuntimeSnapshotMetafield: null,
            },
          },
        }],
      },
    });
    expect(result.operations[0].expand.expandedCartItems).toHaveLength(3);
  });

  it("keeps the candidate-import + static hosted probe isolated from production entries", () => {
    const entry = source("run.dev.prebuilt-candidate-import-static-probe.js");
    expect(entry).toContain("typeof buildPrebuiltBundleRuntimeFunctionCandidate");
    expect(entry).not.toContain("buildPrebuiltBundleRuntimeFunctionCandidate(input)");
    expect(entry).toContain("run.dev.prebuilt-static-probe");
    expect(source("run.js")).not.toContain("prebuilt-candidate-import-static-probe");

    const result = runPrebuiltCandidateImportStaticProbe({
      cart: {
        lines: [{
          id: "gid://shopify/CartLine/prebuilt-candidate-import-probe",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            id: "gid://shopify/ProductVariant/51571819708694",
            product: { id: "gid://shopify/Product/10627515777302" },
          },
        }],
      },
    });
    expect(result.operations[0].expand.expandedCartItems).toHaveLength(3);
  });

  it("keeps the metadata/lookup + static hosted probe isolated from production entries", () => {
    const entry = source("run.dev.prebuilt-metadata-lookup-static-probe.js");
    expect(entry).toContain("observePrebuiltBundleCartMetadata");
    expect(entry).toContain("findPrebuiltBundleRuntimeMapping");
    expect(entry).not.toContain("preparePrebuiltBundleRuntimeSelections");
    expect(entry).not.toContain("buildPrebuiltBundleFunctionResult");
    expect(source("run.js")).not.toContain("prebuilt-metadata-lookup-static-probe");

    const result = runPrebuiltMetadataLookupStaticProbe({
      cart: {
        lines: [{
          id: "gid://shopify/CartLine/prebuilt-metadata-lookup-probe",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            id: "gid://shopify/ProductVariant/51571819708694",
            product: {
              id: "gid://shopify/Product/10627515777302",
              prebuiltRuntimeMappingMetafield: null,
              prebuiltRuntimeSnapshotMetafield: null,
            },
          },
        }],
      },
    });
    expect(result.operations[0].expand.expandedCartItems).toHaveLength(3);
  });

  it("returns identical production and dev output for Standard and Advanced builds", () => {
    const inputs = [
      functionInput({
        builderEfiVariantId: attribute(EFI_FUSION_LITE),
        builderFuelVariantId: attribute(FUEL_TEST),
        builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
      }),
      functionInput({
        builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
        builderFuelVariantId: attribute(FUEL_TEST_2),
        builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
        builderDisplayVariantId: attribute(DISPLAY_8_HD),
      }),
    ];

    inputs.forEach((input) => {
      expect(JSON.stringify(runDev(input))).toBe(JSON.stringify(runProduction(input)));
      expect(JSON.stringify(runStage2(input))).toBe(JSON.stringify(runProduction(input)));
      expect(JSON.stringify(runStage3(input))).toBe(JSON.stringify(runProduction(input)));
      expect(JSON.stringify(runStage4(input))).toBe(JSON.stringify(runProduction(input)));
      expect(JSON.stringify(runStage5(input))).toBe(JSON.stringify(runProduction(input)));
      expect(JSON.stringify(runStage6(input))).toBe(JSON.stringify(runProduction(input)));
      expect(JSON.stringify(runStage7(input))).toBe(JSON.stringify(runProduction(input)));
      expect(JSON.stringify(runStage8(input))).toBe(JSON.stringify(runProduction(input)));
      expect(JSON.stringify(runPrebuiltObserve(input))).toBe(JSON.stringify(runProduction(input)));
      expect(JSON.stringify(runPrebuiltResolveObserve(input))).toBe(JSON.stringify(runProduction(input)));
      expect(JSON.stringify(runPrebuiltCandidate(input))).toBe(JSON.stringify(runProduction(input)));
    });
  });
});
