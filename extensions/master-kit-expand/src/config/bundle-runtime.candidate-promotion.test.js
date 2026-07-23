import { describe, expect, it } from "vitest";
import { run as runProduction } from "../run.js";
import { run as runStage8 } from "../run.dev.stage8.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { promoteRuntimeSnapshotCandidate } from "./bundle-runtime.candidate-promotion.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";

const MASTER_KIT_VARIANT_ID = "gid://shopify/ProductVariant/51505325605142";
const PARENT_PRODUCT_GID = "gid://shopify/Product/10600519598358";
const EFI_FUSION_LITE = "gid://shopify/ProductVariant/51592538587414";
const FUEL_TEST = "gid://shopify/ProductVariant/51505348346134";
const IGNITION_BLACK_JACK = "gid://shopify/ProductVariant/51592730706198";

function input(metafield = null) {
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
            runtimeSnapshotDevMetafield: metafield,
          },
        },
        builderEfiVariantId: { value: EFI_FUSION_LITE },
        builderFuelVariantId: { value: FUEL_TEST },
        builderIgnitionVariantId: { value: IGNITION_BLACK_JACK },
      }],
    },
  };
}

function validMetafield(snapshot = compileRuntimeSnapshot(masterKitConfigV1)) {
  return { jsonValue: snapshot, value: JSON.stringify(snapshot) };
}

function promote(functionInput, dependencies = {}) {
  const hardcodedResult = runProduction(functionInput);
  return {
    hardcodedResult,
    promotion: promoteRuntimeSnapshotCandidate(
      functionInput,
      hardcodedResult,
      dependencies,
    ),
  };
}

describe("Stage 8 Runtime Snapshot candidate promotion", () => {
  it("returns a newly constructed candidate only for exact parity", () => {
    const functionInput = input(validMetafield());
    const { hardcodedResult, promotion } = promote(functionInput);
    const hardcodedBefore = JSON.stringify(hardcodedResult);

    expect(promotion.promoted).toBe(true);
    expect(promotion.comparison).toMatchObject({ match: true, differences: [] });
    expect(promotion.result).not.toBe(hardcodedResult);
    expect(promotion.result.operations).not.toBe(hardcodedResult.operations);
    expect(JSON.stringify(promotion.result)).toBe(hardcodedBefore);
    expect(JSON.stringify(hardcodedResult)).toBe(hardcodedBefore);
    expect(runStage8(functionInput)).toEqual(promotion.result);
  });

  it.each([
    ["missing Snapshot", input(), {}, "missing_snapshot"],
    ["malformed Snapshot", input({ value: "{not-json", jsonValue: null }), {}, "invalid_snapshot"],
    ["hard size limit", input(validMetafield()), {
      sizeGuard: () => ({ ok: false, reason: "snapshot_size_hard_limit" }),
    }, "snapshot_size_hard_limit"],
    ["validation failure", input(validMetafield()), {
      validate: () => ["invalid"],
    }, "invalid_snapshot"],
    ["resolver failure", input(validMetafield()), {
      resolve: () => { throw new Error("resolver failed"); },
    }, "resolver_failed"],
    ["comparison difference", input(validMetafield()), {
      compare: () => ({ match: false, differences: [{ path: "operations[0]" }] }),
    }, "parity_mismatch"],
    ["comparison unsupported field", input(validMetafield()), {
      compare: () => ({
        match: false,
        differences: [{ path: "operations[0].expand.unknown", unsupported: true }],
      }),
    }, "parity_mismatch"],
  ])("falls back to Shared Core when %s", (_name, functionInput, dependencies, reason) => {
    const { hardcodedResult, promotion } = promote(functionInput, dependencies);

    expect(promotion.promoted).toBe(false);
    expect(promotion.fallbackReason).toBe(reason);
    expect(promotion.result).toBe(hardcodedResult);
  });

  it("falls back when the hard-coded result contains an unsupported field", () => {
    const functionInput = input(validMetafield());
    const hardcodedResult = runProduction(functionInput);
    hardcodedResult.operations[0].expand.unknown = true;

    const promotion = promoteRuntimeSnapshotCandidate(functionInput, hardcodedResult);

    expect(promotion.promoted).toBe(false);
    expect(promotion.fallbackReason).toBe("parity_mismatch");
    expect(promotion.result).toBe(hardcodedResult);
    expect(promotion.comparison.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ unsupported: true }),
    ]));
  });
});
