import { describe, expect, it } from "vitest";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { observeRuntimeSnapshotResolution } from "./bundle-runtime.resolution-observation.js";

const EFI_FUSION_LITE = "gid://shopify/ProductVariant/51552319766806";
const EFI_KILLSHOT_2_PRO = "gid://shopify/ProductVariant/51552319865110";
const FUEL_TEST = "gid://shopify/ProductVariant/51505348346134";
const FUEL_TEST_2 = "gid://shopify/ProductVariant/51518319591702";
const IGNITION_BLACK_JACK = "gid://shopify/ProductVariant/51552321011990";
const IGNITION_HIGH_ROLLER = "gid://shopify/ProductVariant/51552321110294";
const DISPLAY_8_HD = "gid://shopify/ProductVariant/51552322584854";

function attribute(value) {
  return { value };
}

function line(snapshot, selections = {}) {
  return {
    merchandise: {
      product: {
        runtimeSnapshotDevMetafield: snapshot ? { jsonValue: snapshot } : null,
      },
    },
    ...selections,
  };
}

function input(lines) {
  return { cart: { lines } };
}

function standardSelections() {
  return {
    builderEfiVariantId: attribute(EFI_FUSION_LITE),
    builderFuelVariantId: attribute(FUEL_TEST),
    builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
  };
}

describe("Stage 6 Runtime Snapshot resolver observation", () => {
  it("resolves a valid Snapshot", () => {
    const result = observeRuntimeSnapshotResolution(input([
      line(compileRuntimeSnapshot(masterKitConfigV1), standardSelections()),
    ]));

    expect(result).toHaveLength(1);
    expect(result[0].resolvedCandidate.components.map((component) => component.variantId)).toEqual([
      EFI_FUSION_LITE,
      FUEL_TEST,
      IGNITION_BLACK_JACK,
    ]);
  });

  it("contains resolver exceptions", () => {
    const selections = {
      ...standardSelections(),
      builderEfiVariantId: attribute({ invalid: true }),
    };

    expect(observeRuntimeSnapshotResolution(input([
      line(compileRuntimeSnapshot(masterKitConfigV1), selections),
    ]))).toBeNull();
  });

  it("uses defaults for invalid or missing selections", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const result = observeRuntimeSnapshotResolution(input([
      line(snapshot, {
        builderEfiVariantId: attribute("gid://shopify/ProductVariant/1"),
      }),
      line(snapshot),
    ]));

    expect(result).toHaveLength(2);
    result.forEach((resolution) => {
      expect(resolution.resolvedCandidate.components.map((component) => component.variantId)).toEqual([
        EFI_FUSION_LITE,
        FUEL_TEST,
        IGNITION_BLACK_JACK,
      ]);
    });
  });

  it("resolves every valid Snapshot across multiple cart lines", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const result = observeRuntimeSnapshotResolution(input([
      line(snapshot, standardSelections()),
      line(snapshot, {
        builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
        builderFuelVariantId: attribute(FUEL_TEST_2),
        builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
        builderDisplayVariantId: attribute(DISPLAY_8_HD),
      }),
    ]));

    expect(result).toHaveLength(2);
    expect(result[1].resolvedCandidate.components.map((component) => component.variantId)).toEqual([
      EFI_KILLSHOT_2_PRO,
      FUEL_TEST_2,
      IGNITION_HIGH_ROLLER,
      DISPLAY_8_HD,
    ]);
  });

  it("validates and resolves each valid Snapshot exactly once", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    let validationCalls = 0;
    let resolverCalls = 0;
    const expectedCandidate = { components: [] };

    const result = observeRuntimeSnapshotResolution(input([
      line(snapshot, standardSelections()),
    ]), {
      validate(value) {
        validationCalls += 1;
        expect(value).toBe(snapshot);
        return [];
      },
      resolve(value) {
        resolverCalls += 1;
        expect(value).toBe(snapshot);
        return expectedCandidate;
      },
    });

    expect(validationCalls).toBe(1);
    expect(resolverCalls).toBe(1);
    expect(result[0].snapshot).toBe(snapshot);
    expect(result[0].resolvedCandidate).toBe(expectedCandidate);
  });
});
