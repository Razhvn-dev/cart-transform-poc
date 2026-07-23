import { describe, expect, it } from "vitest";
import { run as runProduction } from "../run.js";
import { run as runDev } from "../run.dev.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { attachRuntimeSnapshotChecksum } from "./bundle-runtime.checksum.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import {
  RUNTIME_SNAPSHOT_HARD_LIMIT_BYTES,
  RUNTIME_SNAPSHOT_WARNING_BYTES,
  assertRuntimeSnapshotMetafieldSize,
  evaluateRuntimeSnapshotPromotion,
  runDevOnlyRuntimeSnapshot,
  runDevOnlyRuntimeSnapshotShadowComparison,
} from "./bundle-runtime.dev-shadow.js";

const MASTER_KIT_VARIANT_ID = "gid://shopify/ProductVariant/51505325605142";
const EFI_FUSION_LITE = "gid://shopify/ProductVariant/51592538587414";
const EFI_KILLSHOT_2_PRO = "gid://shopify/ProductVariant/51552319865110";
const FUEL_TEST = "gid://shopify/ProductVariant/51505348346134";
const FUEL_TEST_2 = "gid://shopify/ProductVariant/51518319591702";
const IGNITION_BLACK_JACK = "gid://shopify/ProductVariant/51592730706198";
const IGNITION_HIGH_ROLLER = "gid://shopify/ProductVariant/51552321110294";
const DISPLAY_8_HD = "gid://shopify/ProductVariant/51552322584854";
const PARENT_PRODUCT_GID = "gid://shopify/Product/10600519598358";
const BUNDLE_ID = "9c92f2bf-7b9e-4ef8-9c49-7a9d86ec1d31";

function attribute(value) {
  return { value };
}

function runtimeSnapshotMetafield(snapshot) {
  return {
    value: JSON.stringify(snapshot),
    jsonValue: snapshot,
  };
}

function valueOnlyMetafield(value) {
  return {
    value,
    jsonValue: null,
  };
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

function inputWithLine(attributes = {}) {
  return {
    cart: {
      lines: [masterLine(attributes)],
    },
  };
}

function standardAttributes() {
  return {
    builderEfiVariantId: attribute(EFI_FUSION_LITE),
    builderFuelVariantId: attribute(FUEL_TEST),
    builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
  };
}

function advancedAttributes() {
  return {
    builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
    builderFuelVariantId: attribute(FUEL_TEST_2),
    builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
    builderDisplayVariantId: attribute(DISPLAY_8_HD),
  };
}

function productionMetadataAttributes() {
  return {
    bundleId: attribute(BUNDLE_ID),
    bundleSchemaVersion: attribute("1"),
    parentProductGid: attribute("gid://shopify/Product/111"),
    parentVariantGid: attribute("gid://shopify/ProductVariant/111"),
    parentSku: attribute("MASTER-KIT-001"),
    parentTitle: attribute("Master Kit Test"),
  };
}

function withProductMetafield(attributes, metafield) {
  return {
    ...attributes,
    merchandise: {
      __typename: "ProductVariant",
      id: MASTER_KIT_VARIANT_ID,
      product: {
        id: PARENT_PRODUCT_GID,
        runtimeSnapshotDevMetafield: metafield,
      },
    },
  };
}

function expectRunUnchanged(attributes, metafield) {
  const inputWithoutMetafield = inputWithLine(attributes);
  const inputWithMetafield = inputWithLine(withProductMetafield(
    attributes,
    metafield,
  ));

  expect(JSON.stringify(runDev(inputWithMetafield)))
    .toBe(JSON.stringify(runProduction(inputWithoutMetafield)));
}

function mutatedSnapshot(mutator, attachChecksum = true) {
  const snapshot = structuredClone(compileRuntimeSnapshot(masterKitConfigV1));
  mutator(snapshot);
  return attachChecksum ? attachRuntimeSnapshotChecksum(snapshot) : snapshot;
}

function sizedJsonMetafield(sizeBytes) {
  const prefix = "{\"padding\":\"";
  const suffix = "\"}";
  return valueOnlyMetafield(
    `${prefix}${"x".repeat(sizeBytes - prefix.length - suffix.length)}${suffix}`,
  );
}

describe("dev-only runtime snapshot metafield shadow read", () => {
  it("runs a valid metafield snapshot as shadow-only and keeps hard-coded output", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const input = inputWithLine(withProductMetafield(
      advancedAttributes(),
      runtimeSnapshotMetafield(snapshot),
    ));
    const result = runDevOnlyRuntimeSnapshotShadowComparison(input, runProduction(input));

    expect(result.match).toBe(true);
    expect(result.differences).toEqual([]);
    expectRunUnchanged(advancedAttributes(), runtimeSnapshotMetafield(snapshot));
  });

  it("ignores a missing metafield", () => {
    const input = inputWithLine(standardAttributes());

    expect(runDevOnlyRuntimeSnapshotShadowComparison(input, runProduction(input))).toBeNull();
    expect(JSON.stringify(runDev(input))).toBe(JSON.stringify(runProduction(input)));
  });

  it("ignores malformed value JSON", () => {
    expectRunUnchanged(
      standardAttributes(),
      valueOnlyMetafield("{not-json"),
    );
  });

  it("ignores unsupported schema", () => {
    expectRunUnchanged(
      standardAttributes(),
      runtimeSnapshotMetafield(mutatedSnapshot((snapshot) => {
        snapshot.snapshot_schema = "bundle_runtime.v2";
      }, false)),
    );
  });

  it("ignores checksum mismatch", () => {
    expectRunUnchanged(
      standardAttributes(),
      runtimeSnapshotMetafield(mutatedSnapshot((snapshot) => {
        snapshot.groups[0].options[0].price_cents += 1;
      }, false)),
    );
  });

  it("ignores resolver mismatch and preserves returned operations", () => {
    expectRunUnchanged(
      standardAttributes(),
      runtimeSnapshotMetafield(mutatedSnapshot((snapshot) => {
        snapshot.groups[0].options[0].price_cents += 100;
      })),
    );
  });

  it("ignores snapshot parse failure", () => {
    expectRunUnchanged(
      standardAttributes(),
      valueOnlyMetafield(""),
    );
  });

  it("keeps multiple lines hard-coded even when the dev metafield is present", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const inputWithoutMetafield = {
      cart: {
        lines: [
          masterLine({
            ...productionMetadataAttributes(),
            ...standardAttributes(),
          }),
          masterLine({
            id: "gid://shopify/CartLine/2",
            ...advancedAttributes(),
          }),
        ],
      },
    };
    const inputWithMetafield = {
      cart: {
        lines: [
          masterLine(withProductMetafield({
            ...productionMetadataAttributes(),
            ...standardAttributes(),
          }, runtimeSnapshotMetafield(snapshot))),
          masterLine({
            id: "gid://shopify/CartLine/2",
            ...advancedAttributes(),
          }),
        ],
      },
    };

    expect(JSON.stringify(runDev(inputWithMetafield)))
      .toBe(JSON.stringify(runProduction(inputWithoutMetafield)));
  });
});

describe("dev-only runtime snapshot modes", () => {
  it("defaults to shadow mode and never promotes candidate output", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const input = inputWithLine(withProductMetafield(
      advancedAttributes(),
      runtimeSnapshotMetafield(snapshot),
    ));
    const hardcodedResult = runProduction(input);
    const result = runDevOnlyRuntimeSnapshot(input, hardcodedResult);

    expect(result.mode).toBe("shadow");
    expect(result.promoted).toBe(false);
    expect(result.fallbackReason).toBe("mode_shadow");
    expect(JSON.stringify(result.result)).toBe(JSON.stringify(hardcodedResult));
    expect(JSON.stringify(runDev(input))).toBe(JSON.stringify(hardcodedResult));
  });

  it("hardcoded mode bypasses snapshot promotion even when all gates would pass", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const input = inputWithLine(withProductMetafield(
      advancedAttributes(),
      runtimeSnapshotMetafield(snapshot),
    ));
    const hardcodedResult = runProduction(input);
    const result = runDevOnlyRuntimeSnapshot(input, hardcodedResult, {
      runtimeMode: "hardcoded",
    });

    expect(result).toMatchObject({
      mode: "hardcoded",
      promoted: false,
      fallbackReason: "mode_hardcoded",
    });
    expect(JSON.stringify(result.result)).toBe(JSON.stringify(hardcodedResult));
  });

  it("candidate mode returns snapshot output only when every promotion gate passes", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const input = inputWithLine(withProductMetafield(
      advancedAttributes(),
      runtimeSnapshotMetafield(snapshot),
    ));
    const hardcodedResult = runProduction(input);
    const result = runDevOnlyRuntimeSnapshot(input, hardcodedResult, {
      runtimeMode: "candidate",
    });

    expect(result.mode).toBe("candidate");
    expect(result.promoted).toBe(true);
    expect(result.comparison.match).toBe(true);
    expect(result.comparison.differences).toEqual([]);
    expect(result.result).not.toBe(hardcodedResult);
    expect(result.result.operations).not.toBe(hardcodedResult.operations);
    expect(JSON.stringify(result.result)).toBe(JSON.stringify(hardcodedResult));
    expect(JSON.stringify(runDev(input, { runtimeMode: "candidate" })))
      .toBe(JSON.stringify(hardcodedResult));
  });

  it("candidate mode falls back when the snapshot is missing", () => {
    const input = inputWithLine(standardAttributes());
    const hardcodedResult = runProduction(input);
    const result = runDevOnlyRuntimeSnapshot(input, hardcodedResult, {
      runtimeMode: "candidate",
    });

    expect(result.promoted).toBe(false);
    expect(result.fallbackReason).toBe("missing_snapshot");
    expect(JSON.stringify(result.result)).toBe(JSON.stringify(hardcodedResult));
  });

  it("candidate mode falls back when snapshot JSON is malformed", () => {
    const input = inputWithLine(withProductMetafield(
      standardAttributes(),
      valueOnlyMetafield("{not-json"),
    ));
    const hardcodedResult = runProduction(input);
    const result = runDevOnlyRuntimeSnapshot(input, hardcodedResult, {
      runtimeMode: "candidate",
    });

    expect(result.promoted).toBe(false);
    expect(result.fallbackReason).toBe("invalid_snapshot");
    expect(JSON.stringify(result.result)).toBe(JSON.stringify(hardcodedResult));
  });

  it("candidate mode falls back when schema or checksum validation fails", () => {
    const invalidSnapshot = mutatedSnapshot((snapshot) => {
      snapshot.snapshot_schema = "bundle_runtime.v2";
    }, false);
    const input = inputWithLine(withProductMetafield(
      standardAttributes(),
      runtimeSnapshotMetafield(invalidSnapshot),
    ));
    const hardcodedResult = runProduction(input);
    const result = runDevOnlyRuntimeSnapshot(input, hardcodedResult, {
      runtimeMode: "candidate",
    });

    expect(result.promoted).toBe(false);
    expect(result.fallbackReason).toBe("invalid_snapshot");
    expect(JSON.stringify(result.result)).toBe(JSON.stringify(hardcodedResult));
  });

  it("allows exactly the 9000-byte hard limit boundary through the size guard", () => {
    const result = assertRuntimeSnapshotMetafieldSize(
      sizedJsonMetafield(RUNTIME_SNAPSHOT_HARD_LIMIT_BYTES),
    );

    expect(result).toMatchObject({
      ok: true,
      sizeBytes: RUNTIME_SNAPSHOT_HARD_LIMIT_BYTES,
    });
  });

  it("marks snapshots over the warning threshold without hard rejection", () => {
    const result = assertRuntimeSnapshotMetafieldSize(
      sizedJsonMetafield(RUNTIME_SNAPSHOT_WARNING_BYTES + 1),
    );

    expect(result).toMatchObject({
      ok: true,
      warning: "snapshot_size_warning",
      sizeBytes: RUNTIME_SNAPSHOT_WARNING_BYTES + 1,
    });
  });

  it("candidate mode falls back when the snapshot exceeds the 9000-byte hard limit", () => {
    const input = inputWithLine(withProductMetafield(
      standardAttributes(),
      sizedJsonMetafield(RUNTIME_SNAPSHOT_HARD_LIMIT_BYTES + 1),
    ));
    const hardcodedResult = runProduction(input);
    const result = runDevOnlyRuntimeSnapshot(input, hardcodedResult, {
      runtimeMode: "candidate",
    });

    expect(result.promoted).toBe(false);
    expect(result.fallbackReason).toBe("snapshot_size_hard_limit");
    expect(JSON.stringify(result.result)).toBe(JSON.stringify(hardcodedResult));
  });

  it("candidate mode falls back when snapshot output does not match hard-coded output", () => {
    const mismatchSnapshot = mutatedSnapshot((snapshot) => {
      snapshot.groups[0].options[0].price_cents += 100;
    });
    const input = inputWithLine(withProductMetafield(
      standardAttributes(),
      runtimeSnapshotMetafield(mismatchSnapshot),
    ));
    const hardcodedResult = runProduction(input);
    const result = runDevOnlyRuntimeSnapshot(input, hardcodedResult, {
      runtimeMode: "candidate",
    });

    expect(result.promoted).toBe(false);
    expect(result.fallbackReason).toBe("parity_mismatch");
    expect(result.comparison.match).toBe(false);
    expect(JSON.stringify(result.result)).toBe(JSON.stringify(hardcodedResult));
  });

  it("candidate mode falls back when hard-coded output contains an unknown operation field", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const input = inputWithLine(withProductMetafield(
      standardAttributes(),
      runtimeSnapshotMetafield(snapshot),
    ));
    const hardcodedResult = runProduction(input);
    hardcodedResult.operations[0].expand.unsupportedField = true;

    const result = runDevOnlyRuntimeSnapshot(input, hardcodedResult, {
      runtimeMode: "candidate",
    });

    expect(result.promoted).toBe(false);
    expect(result.fallbackReason).toBe("parity_mismatch");
    expect(result.comparison.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "operations[0].expand.unsupportedField",
        unsupported: true,
      }),
    ]));
    expect(result.result).toBe(hardcodedResult);
  });

  it("uses shadow as the fallback for unknown runtime modes", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const input = inputWithLine(withProductMetafield(
      standardAttributes(),
      runtimeSnapshotMetafield(snapshot),
    ));
    const hardcodedResult = runProduction(input);
    const result = runDevOnlyRuntimeSnapshot(input, hardcodedResult, {
      runtimeMode: "unknown",
    });

    expect(result.mode).toBe("shadow");
    expect(result.promoted).toBe(false);
    expect(JSON.stringify(result.result)).toBe(JSON.stringify(hardcodedResult));
  });

  it("reports promotion success without mutating the hard-coded result", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const input = inputWithLine(withProductMetafield(
      {
        ...productionMetadataAttributes(),
        ...advancedAttributes(),
      },
      runtimeSnapshotMetafield(snapshot),
    ));
    const hardcodedResult = runProduction(input);
    const before = JSON.stringify(hardcodedResult);
    const promotion = evaluateRuntimeSnapshotPromotion(input, hardcodedResult);

    expect(promotion.promoted).toBe(true);
    expect(promotion.comparison.match).toBe(true);
    expect(JSON.stringify(hardcodedResult)).toBe(before);
  });

  it("keeps candidate result independent from later hard-coded result mutation", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const input = inputWithLine(withProductMetafield(
      advancedAttributes(),
      runtimeSnapshotMetafield(snapshot),
    ));
    const hardcodedResult = runProduction(input);
    const result = runDevOnlyRuntimeSnapshot(input, hardcodedResult, {
      runtimeMode: "candidate",
    });
    const promotedBefore = JSON.stringify(result.result);

    hardcodedResult.operations[0].expand.title = "mutated hardcoded title";

    expect(result.promoted).toBe(true);
    expect(JSON.stringify(result.result)).toBe(promotedBefore);
    expect(result.result.operations[0].expand.title).toBe("Master Kit Test");
  });

  it("does not let cart or metafield input change the dev runtime mode", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const input = inputWithLine(withProductMetafield(
      {
        ...standardAttributes(),
        runtimeMode: attribute("candidate"),
        devRuntimeMode: attribute("candidate"),
      },
      {
        value: JSON.stringify({
          ...snapshot,
          runtimeMode: "candidate",
          devRuntimeMode: "candidate",
        }),
        jsonValue: {
          ...snapshot,
          runtimeMode: "candidate",
          devRuntimeMode: "candidate",
        },
      },
    ));
    const hardcodedResult = runProduction(input);
    const result = runDevOnlyRuntimeSnapshot(input, hardcodedResult);

    expect(result.mode).toBe("shadow");
    expect(result.promoted).toBe(false);
    expect(JSON.stringify(result.result)).toBe(JSON.stringify(hardcodedResult));
  });
});
