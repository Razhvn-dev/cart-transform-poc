import { describe, expect, it } from "vitest";
import { run as runProduction } from "../run.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { observeRuntimeSnapshotComparison } from "./bundle-runtime.comparison-observation.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { observeRuntimeSnapshotResolution } from "./bundle-runtime.resolution-observation.js";

const MASTER_KIT_VARIANT_ID = "gid://shopify/ProductVariant/51505325605142";
const PARENT_PRODUCT_GID = "gid://shopify/Product/10600519598358";
const EFI_FUSION_LITE = "gid://shopify/ProductVariant/51552319766806";
const FUEL_TEST = "gid://shopify/ProductVariant/51505348346134";
const IGNITION_BLACK_JACK = "gid://shopify/ProductVariant/51552321011990";

function attribute(value) {
  return { value };
}

function input(snapshot = null) {
  return {
    cart: {
      lines: [{
        id: "gid://shopify/CartLine/99",
        quantity: 1,
        merchandise: {
          __typename: "ProductVariant",
          id: MASTER_KIT_VARIANT_ID,
          product: {
            id: PARENT_PRODUCT_GID,
            runtimeSnapshotDevMetafield: snapshot ? { jsonValue: snapshot } : null,
          },
        },
        builderEfiVariantId: attribute(EFI_FUSION_LITE),
        builderFuelVariantId: attribute(FUEL_TEST),
        builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
      }],
    },
  };
}

describe("Stage 7 Runtime Snapshot comparator observation", () => {
  it("executes a matching comparison for a valid Snapshot", () => {
    const functionInput = input(compileRuntimeSnapshot(masterKitConfigV1));

    expect(observeRuntimeSnapshotComparison(
      runProduction(functionInput),
      observeRuntimeSnapshotResolution(functionInput),
    ))
      .toMatchObject({ match: true, differences: [] });
  });

  it("observes a mismatch without changing the hard-coded result", () => {
    const functionInput = input(compileRuntimeSnapshot(masterKitConfigV1));
    const hardcodedResult = runProduction(functionInput);
    hardcodedResult.operations[0].expand.unsupportedField = true;

    expect(observeRuntimeSnapshotComparison(
      hardcodedResult,
      observeRuntimeSnapshotResolution(functionInput),
    ))
      .toMatchObject({ match: false });
    expect(hardcodedResult.operations[0].expand.unsupportedField).toBe(true);
  });

  it("ignores a missing or invalid Snapshot", () => {
    expect(observeRuntimeSnapshotComparison(runProduction(input()), [])).toBeNull();

    const invalidSnapshot = structuredClone(compileRuntimeSnapshot(masterKitConfigV1));
    invalidSnapshot.snapshot_schema = "bundle_runtime.v2";
    const invalidInput = input(invalidSnapshot);
    expect(observeRuntimeSnapshotComparison(
      runProduction(invalidInput),
      observeRuntimeSnapshotResolution(invalidInput),
    )).toBeNull();
  });

  it("contains comparator exceptions", () => {
    const functionInput = input(compileRuntimeSnapshot(masterKitConfigV1));
    const hardcodedResult = runProduction(functionInput);
    Object.defineProperty(hardcodedResult, "operations", {
      get() {
        throw new Error("comparison observer test exception");
      },
    });

    expect(observeRuntimeSnapshotComparison(
      hardcodedResult,
      observeRuntimeSnapshotResolution(functionInput),
    )).toBeNull();
  });
});
