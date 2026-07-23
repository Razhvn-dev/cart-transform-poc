import { describe, expect, it } from "vitest";
import { run } from "../run.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { attachRuntimeSnapshotChecksum } from "./bundle-runtime.checksum.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import {
  compareHardcodedToRuntimeSnapshot,
  normalizeFunctionResult,
} from "./bundle-runtime.shadow-comparison.js";

const MASTER_KIT_VARIANT_ID = "gid://shopify/ProductVariant/51505325605142";
const EFI_FUSION_LITE = "gid://shopify/ProductVariant/51592538587414";
const EFI_KILLSHOT_2_PRO = "gid://shopify/ProductVariant/51552319865110";
const FUEL_TEST = "gid://shopify/ProductVariant/51505348346134";
const FUEL_TEST_2 = "gid://shopify/ProductVariant/51518319591702";
const IGNITION_BLACK_JACK = "gid://shopify/ProductVariant/51592730706198";
const IGNITION_HIGH_ROLLER = "gid://shopify/ProductVariant/51552321110294";
const DISPLAY_5_HD = "gid://shopify/ProductVariant/51552321175830";
const DISPLAY_8_HD = "gid://shopify/ProductVariant/51552322584854";
const WRONG_VARIANT = "gid://shopify/ProductVariant/999999999";
const PARENT_PRODUCT_GID = "gid://shopify/Product/10600519598358";
const SECOND_BUNDLE_ID = "6a6d45ff-1798-49f5-b6b2-855955f96ebb";
const BUNDLE_ID = "9c92f2bf-7b9e-4ef8-9c49-7a9d86ec1d31";

function attribute(value) {
  return { value };
}

function metafield(snapshot) {
  return {
    value: JSON.stringify(snapshot),
    jsonValue: snapshot,
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

function nonMasterLine() {
  return {
    id: "gid://shopify/CartLine/non-master",
    quantity: 1,
    merchandise: {
      __typename: "ProductVariant",
      id: "gid://shopify/ProductVariant/1",
      product: {
        id: "gid://shopify/Product/1",
      },
    },
  };
}

function functionInput(linesOrAttributes = {}) {
  return {
    cart: {
      lines: Array.isArray(linesOrAttributes)
        ? linesOrAttributes
        : [masterLine(linesOrAttributes)],
    },
  };
}

function productionMetadataAttributes(overrides = {}) {
  return {
    bundleId: attribute(overrides.bundleId ?? BUNDLE_ID),
    bundleSchemaVersion: attribute(overrides.bundleSchemaVersion ?? "1"),
    parentProductGid: attribute(
      overrides.parentProductGid ?? "gid://shopify/Product/111",
    ),
    parentVariantGid: attribute(
      overrides.parentVariantGid ?? "gid://shopify/ProductVariant/111",
    ),
    parentSku: attribute(overrides.parentSku ?? "MASTER-KIT-001"),
    parentTitle: attribute(overrides.parentTitle ?? "Master Kit Test"),
  };
}

function withSnapshotMetafield(attributes, snapshot = compileRuntimeSnapshot(masterKitConfigV1)) {
  return {
    ...attributes,
    merchandise: {
      __typename: "ProductVariant",
      id: MASTER_KIT_VARIANT_ID,
      product: {
        id: PARENT_PRODUCT_GID,
        runtimeSnapshotDevMetafield: metafield(snapshot),
      },
    },
  };
}

function standardAttributes(overrides = {}) {
  return {
    builderEfiVariantId: attribute(EFI_FUSION_LITE),
    builderFuelVariantId: attribute(FUEL_TEST),
    builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
    ...overrides,
  };
}

function advancedAttributes(overrides = {}) {
  return {
    builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
    builderFuelVariantId: attribute(FUEL_TEST_2),
    builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
    builderDisplayVariantId: attribute(DISPLAY_8_HD),
    ...overrides,
  };
}

function expectParity(input) {
  const hardcodedBefore = normalizeFunctionResult(run(input));
  const result = compareHardcodedToRuntimeSnapshot(input, {
    hardcodedResult: run(input),
    snapshot: compileRuntimeSnapshot(masterKitConfigV1),
  });

  expect(result.match).toBe(true);
  expect(result.differences).toEqual([]);
  expect(result.hardcoded).toEqual(result.snapshot);
  expect(normalizeFunctionResult(run(input))).toEqual(hardcodedBefore);

  return result;
}

function compareWithSnapshot(input, snapshot) {
  return compareHardcodedToRuntimeSnapshot(input, {
    hardcodedResult: run(input),
    snapshot,
  });
}

function mutatedSnapshot(mutator) {
  const snapshot = structuredClone(compileRuntimeSnapshot(masterKitConfigV1));
  mutator(snapshot);
  return attachRuntimeSnapshotChecksum(snapshot);
}

describe("runtime snapshot shadow comparison parity matrix", () => {
  it.each([
    ["Fusion Lite + Fuel Test 2 fallback", standardAttributes({
      builderFuelVariantId: attribute(FUEL_TEST_2),
    })],
    ["Fusion Lite with Display supplied", standardAttributes({
      builderDisplayVariantId: attribute(DISPLAY_8_HD),
    })],
    ["Pro + Display 5", advancedAttributes({
      builderDisplayVariantId: attribute(DISPLAY_5_HD),
    })],
    ["Pro + Display 8", advancedAttributes()],
    ["invalid EFI/Fuel/Ignition/Display GIDs", {
      builderEfiVariantId: attribute("gid://shopify/ProductVariant/1"),
      builderFuelVariantId: attribute("gid://shopify/ProductVariant/2"),
      builderIgnitionVariantId: attribute("gid://shopify/ProductVariant/3"),
      builderDisplayVariantId: attribute("gid://shopify/ProductVariant/4"),
    }],
    ["missing optional Display", advancedAttributes({
      builderDisplayVariantId: undefined,
    })],
    ["legacy metadata line", standardAttributes()],
    ["production metadata line", {
      ...productionMetadataAttributes(),
      ...advancedAttributes(),
    }],
    ["price rounding/allocation", advancedAttributes()],
    ["parent Product/Variant authority", {
      ...productionMetadataAttributes({
        parentProductGid: "gid://shopify/Product/111",
        parentVariantGid: "gid://shopify/ProductVariant/111",
      }),
      ...standardAttributes(),
    }],
  ])("%s", (_name, attributes) => {
    expectParity(functionInput(attributes));
  });

  it("matches two Master Kit lines", () => {
    expectParity(functionInput([
      masterLine(standardAttributes()),
      masterLine({
        id: "gid://shopify/CartLine/100",
        ...advancedAttributes(),
      }),
    ]));
  });

  it("matches production + legacy lines together", () => {
    expectParity(functionInput([
      masterLine({
        ...productionMetadataAttributes(),
        ...standardAttributes(),
      }),
      masterLine({
        id: "gid://shopify/CartLine/legacy",
        ...advancedAttributes(),
      }),
    ]));
  });

  it("matches two identical selections with different bundle IDs", () => {
    const result = expectParity(functionInput([
      masterLine({
        ...productionMetadataAttributes({ bundleId: BUNDLE_ID }),
        ...standardAttributes(),
      }),
      masterLine({
        id: "gid://shopify/CartLine/second",
        ...productionMetadataAttributes({ bundleId: SECOND_BUNDLE_ID }),
        ...standardAttributes(),
      }),
    ]));

    expect(
      result.hardcoded.operations.map((operation) =>
        operation.expand.expandedCartItems[0].attributes.find(
          (item) => item.key === "_bundle_id",
        ).value,
      ),
    ).toEqual([BUNDLE_ID, SECOND_BUNDLE_ID]);
  });

  it("ignores non-Master lines", () => {
    expectParity(functionInput([
      nonMasterLine(),
      masterLine(standardAttributes()),
    ]));
  });
});

describe("runtime snapshot shadow comparison intentional mismatches", () => {
  it("detects wrong variant", () => {
    const result = compareWithSnapshot(
      functionInput(standardAttributes()),
      mutatedSnapshot((snapshot) => {
        snapshot.groups[0].options[0].variant_gid = WRONG_VARIANT;
      }),
    );

    expect(result.match).toBe(false);
    expect(result.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "operations[0].expand.expandedCartItems[0].merchandiseId",
        hardcoded: EFI_FUSION_LITE,
        snapshot: WRONG_VARIANT,
      }),
    ]));
  });

  it("detects wrong price", () => {
    const result = compareWithSnapshot(
      functionInput(standardAttributes()),
      mutatedSnapshot((snapshot) => {
        snapshot.groups[0].options[0].price_cents += 100;
      }),
    );

    expect(result.match).toBe(false);
    expect(result.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "operations[0].expand.expandedCartItems[0].amount",
        hardcoded: "512.99",
        snapshot: "513.94",
      }),
    ]));
  });

  it("detects wrong sequence", () => {
    const result = compareWithSnapshot(
      functionInput({
        ...productionMetadataAttributes(),
        ...standardAttributes(),
      }),
      mutatedSnapshot((snapshot) => {
        const fuel = snapshot.groups[1];
        snapshot.groups[1] = snapshot.groups[2];
        snapshot.groups[2] = fuel;
      }),
    );

    expect(result.match).toBe(false);
    expect(result.differences.some((difference) =>
      difference.path.includes("expandedCartItems[1]")
    )).toBe(true);
  });

  it("detects missing component", () => {
    const result = compareWithSnapshot(
      functionInput(advancedAttributes()),
      mutatedSnapshot((snapshot) => {
        snapshot.rules.push({
          id: "hide-display-for-pro-test",
          order: 30,
          effect: "visibility",
          match: "all",
          when: [{
            group: "efi_system",
            operator: "selected",
            option: "efi_killshot_2_pro",
          }],
          target: { group: "display" },
          visible: false,
          component_included: false,
        });
      }),
    );

    expect(result.match).toBe(false);
    expect(result.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "operations[0].expand.expandedCartItems[3]",
      }),
    ]));
  });

  it("detects unexpected Display", () => {
    const result = compareWithSnapshot(
      functionInput(standardAttributes({
        builderDisplayVariantId: attribute(DISPLAY_8_HD),
      })),
      mutatedSnapshot((snapshot) => {
        snapshot.rules = snapshot.rules.filter(
          (rule) => rule.id !== "fusion-lite-hide-display",
        );
      }),
    );

    expect(result.match).toBe(false);
    expect(result.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "operations[0].expand.expandedCartItems[3]",
      }),
    ]));
  });

  it("detects wrong group/role", () => {
    const result = compareWithSnapshot(
      functionInput({
        ...productionMetadataAttributes(),
        ...standardAttributes(),
      }),
      mutatedSnapshot((snapshot) => {
        snapshot.groups[0].options[0].metadata_role = "wrong_role";
      }),
    );

    expect(result.match).toBe(false);
    expect(result.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "operations[0].expand.expandedCartItems[0].attributes[3].value",
        hardcoded: "efi",
        snapshot: "wrong_role",
      }),
    ]));
  });
});

describe("runtime snapshot dev metafield input remains shadow-only", () => {
  it("keeps hard-coded output byte/value equivalent with a valid metafield snapshot", () => {
    const inputWithoutMetafield = functionInput(advancedAttributes());
    const inputWithMetafield = functionInput(withSnapshotMetafield(advancedAttributes()));

    expect(JSON.stringify(run(inputWithMetafield)))
      .toBe(JSON.stringify(run(inputWithoutMetafield)));
  });
});
