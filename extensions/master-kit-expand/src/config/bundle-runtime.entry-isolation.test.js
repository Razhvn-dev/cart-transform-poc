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
    });
  });
});
