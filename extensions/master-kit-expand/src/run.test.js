import { describe, it, expect } from "vitest";
import { run } from "./run.js";

const MASTER_KIT_VARIANT_ID = "gid://shopify/ProductVariant/51505325605142";
const EFI_FUSION_LITE = "gid://shopify/ProductVariant/51552319766806";
const EFI_KILLSHOT_2_PRO = "gid://shopify/ProductVariant/51552319865110";
const FUEL_TEST = "gid://shopify/ProductVariant/51505348346134";
const FUEL_TEST_2 = "gid://shopify/ProductVariant/51518319591702";
const IGNITION_BLACK_JACK = "gid://shopify/ProductVariant/51552321011990";
const IGNITION_HIGH_ROLLER = "gid://shopify/ProductVariant/51552321110294";
const DISPLAY_8_HD = "gid://shopify/ProductVariant/51552322584854";
const BUNDLE_ID = "9c92f2bf-7b9e-4ef8-9c49-7a9d86ec1d31";
const SECOND_BUNDLE_ID = "6a6d45ff-1798-49f5-b6b2-855955f96ebb";
const PARENT_PRODUCT_GID = "gid://shopify/Product/999";
const CLIENT_PARENT_PRODUCT_GID = "gid://shopify/Product/111";
const CLIENT_PARENT_VARIANT_GID = "gid://shopify/ProductVariant/111";
const PARENT_SKU = "MASTER-KIT-001";
const PARENT_TITLE = "Master Kit Test";

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

function attribute(value) {
  return { value };
}

function expandedItems(result) {
  return result.operations[0].expand.expandedCartItems;
}

function totalExpandedAmount(result) {
  return expandedItems(result).reduce(
    (total, item) =>
      total +
      Math.round(
        Number(item.price.adjustment.fixedPricePerUnit.amount) * 100,
      ),
    0,
  );
}

function productionMetadataAttributes(overrides = {}) {
  return {
    bundleId: attribute(overrides.bundleId ?? BUNDLE_ID),
    bundleSchemaVersion: attribute(overrides.bundleSchemaVersion ?? "1"),
    parentProductGid: attribute(
      overrides.parentProductGid ?? CLIENT_PARENT_PRODUCT_GID,
    ),
    parentVariantGid: attribute(
      overrides.parentVariantGid ?? CLIENT_PARENT_VARIANT_GID,
    ),
    parentSku: attribute(overrides.parentSku ?? PARENT_SKU),
    parentTitle: attribute(overrides.parentTitle ?? PARENT_TITLE),
  };
}

function attributeMap(item) {
  return Object.fromEntries(
    (item.attributes || []).map((itemAttribute) => [
      itemAttribute.key,
      itemAttribute.value,
    ]),
  );
}

function expectSharedProductionMetadata(item, bundleId = BUNDLE_ID) {
  expect(attributeMap(item)).toMatchObject({
    _bundle_id: bundleId,
    _bundle_schema_version: "1",
    _parent_product_gid: PARENT_PRODUCT_GID,
    _parent_variant_gid: MASTER_KIT_VARIANT_ID,
    _parent_sku: PARENT_SKU,
    _parent_title: PARENT_TITLE,
  });
}

describe("master kit expand", () => {
  it("returns no changes for unrelated products", () => {
    const result = run({
      cart: {
        lines: [
          {
            id: "gid://shopify/CartLine/1",
            quantity: 1,
            merchandise: {
              __typename: "ProductVariant",
              id: "gid://shopify/ProductVariant/1",
            },
          },
        ],
      },
    });

    expect(result).toEqual({ operations: [] });
  });

  it("expands Standard Build into three real components totaling $750.48", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            builderEfiVariantId: attribute(EFI_FUSION_LITE),
            builderFuelVariantId: attribute(FUEL_TEST),
            builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
          }),
        ],
      },
    });

    expect(expandedItems(result)).toEqual([
      {
        merchandiseId: EFI_FUSION_LITE,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: "512.99",
            },
          },
        },
      },
      {
        merchandiseId: FUEL_TEST,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: "190.00",
            },
          },
        },
      },
      {
        merchandiseId: IGNITION_BLACK_JACK,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: "47.49",
            },
          },
        },
      },
    ]);
    expect(totalExpandedAmount(result)).toBe(75048);
  });

  it("expands Advanced Build into four real components totaling $2,026.32", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
            builderFuelVariantId: attribute(FUEL_TEST_2),
            builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
            builderDisplayVariantId: attribute(DISPLAY_8_HD),
          }),
        ],
      },
    });

    expect(expandedItems(result)).toEqual([
      {
        merchandiseId: EFI_KILLSHOT_2_PRO,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: "750.49",
            },
          },
        },
      },
      {
        merchandiseId: FUEL_TEST_2,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: "332.50",
            },
          },
        },
      },
      {
        merchandiseId: IGNITION_HIGH_ROLLER,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: "325.84",
            },
          },
        },
      },
      {
        merchandiseId: DISPLAY_8_HD,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: "617.49",
            },
          },
        },
      },
    ]);
    expect(totalExpandedAmount(result)).toBe(202632);
  });

  it("adds full production metadata attributes to Standard Build components", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            ...productionMetadataAttributes(),
            builderEfiVariantId: attribute(EFI_FUSION_LITE),
            builderFuelVariantId: attribute(FUEL_TEST),
            builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
          }),
        ],
      },
    });
    const items = expandedItems(result);

    expect(items).toHaveLength(3);
    items.forEach((item) => expectSharedProductionMetadata(item));
    expect(items.map((item) => attributeMap(item)._bundle_id)).toEqual([
      BUNDLE_ID,
      BUNDLE_ID,
      BUNDLE_ID,
    ]);
    expect(items.map((item) => attributeMap(item)._component_sequence)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(attributeMap(items[0])).toMatchObject({
      _component_group: "efi_system",
      _component_role: "efi",
      _component_variant_gid: EFI_FUSION_LITE,
    });
    expect(attributeMap(items[1])).toMatchObject({
      _component_group: "fuel_system",
      _component_role: "fuel_delivery",
      _component_variant_gid: FUEL_TEST,
    });
    expect(attributeMap(items[2])).toMatchObject({
      _component_group: "ignition",
      _component_role: "ignition",
      _component_variant_gid: IGNITION_BLACK_JACK,
    });
    expect(totalExpandedAmount(result)).toBe(75048);
  });

  it("adds trusted Display metadata only when Display is part of the resolved components", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            ...productionMetadataAttributes(),
            builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
            builderFuelVariantId: attribute(FUEL_TEST_2),
            builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
            builderDisplayVariantId: attribute(DISPLAY_8_HD),
          }),
        ],
      },
    });
    const items = expandedItems(result);

    expect(items).toHaveLength(4);
    expect(items.map((item) => attributeMap(item)._component_sequence)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(attributeMap(items[3])).toMatchObject({
      _component_group: "display",
      _component_role: "display_controller",
      _component_variant_gid: DISPLAY_8_HD,
    });
    expect(totalExpandedAmount(result)).toBe(202632);
  });

  it("falls back safely for invalid or missing properties", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            builderEfiVariantId: attribute("gid://shopify/ProductVariant/1"),
            builderFuelVariantId: attribute("gid://shopify/ProductVariant/2"),
            builderIgnitionVariantId: attribute("gid://shopify/ProductVariant/3"),
            builderDisplayVariantId: attribute("gid://shopify/ProductVariant/4"),
          }),
        ],
      },
    });

    expect(expandedItems(result).map((item) => item.merchandiseId)).toEqual([
      EFI_FUSION_LITE,
      FUEL_TEST,
      IGNITION_BLACK_JACK,
    ]);
    expect(totalExpandedAmount(result)).toBe(75048);
  });

  it("uses fallback component metadata for invalid component selections", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            ...productionMetadataAttributes(),
            builderEfiVariantId: attribute("gid://shopify/ProductVariant/1"),
            builderFuelVariantId: attribute("gid://shopify/ProductVariant/2"),
            builderIgnitionVariantId: attribute("gid://shopify/ProductVariant/3"),
            builderDisplayVariantId: attribute("gid://shopify/ProductVariant/4"),
          }),
        ],
      },
    });
    const items = expandedItems(result);

    expect(items.map((item) => item.merchandiseId)).toEqual([
      EFI_FUSION_LITE,
      FUEL_TEST,
      IGNITION_BLACK_JACK,
    ]);
    expect(items.map((item) => attributeMap(item)._component_variant_gid)).toEqual([
      EFI_FUSION_LITE,
      FUEL_TEST,
      IGNITION_BLACK_JACK,
    ]);
  });

  it("enforces EFI/Fuel compatibility by falling Fuel Test 2 back under Fusion Lite", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            builderEfiVariantId: attribute(EFI_FUSION_LITE),
            builderFuelVariantId: attribute(FUEL_TEST_2),
            builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
          }),
        ],
      },
    });

    expect(expandedItems(result).map((item) => item.merchandiseId)).toEqual([
      EFI_FUSION_LITE,
      FUEL_TEST,
      IGNITION_BLACK_JACK,
    ]);
  });

  it("excludes hidden Display for Fusion Lite even when the property is tampered", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            builderEfiVariantId: attribute(EFI_FUSION_LITE),
            builderFuelVariantId: attribute(FUEL_TEST),
            builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
            builderDisplayVariantId: attribute(DISPLAY_8_HD),
          }),
        ],
      },
    });

    expect(expandedItems(result)).toHaveLength(3);
    expect(expandedItems(result).some((item) => item.merchandiseId === DISPLAY_8_HD))
      .toBe(false);
  });

  it("does not let client metadata override group, role, or parent variant identity", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            ...productionMetadataAttributes({
              parentVariantGid: "gid://shopify/ProductVariant/999999",
            }),
            builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
            builderFuelVariantId: attribute(FUEL_TEST_2),
            builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
            builderDisplayVariantId: attribute(DISPLAY_8_HD),
            componentGroup: attribute("client_group"),
            componentRole: attribute("client_role"),
          }),
        ],
      },
    });
    const firstItemMetadata = attributeMap(expandedItems(result)[0]);

    expect(firstItemMetadata).toMatchObject({
      _parent_variant_gid: MASTER_KIT_VARIANT_ID,
      _component_group: "efi_system",
      _component_role: "efi",
    });
  });

  it("does not let a client parent product GID override the actual parent product identity", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            ...productionMetadataAttributes({
              parentProductGid: "gid://shopify/Product/123456",
            }),
            builderEfiVariantId: attribute(EFI_FUSION_LITE),
            builderFuelVariantId: attribute(FUEL_TEST),
            builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
          }),
        ],
      },
    });

    expect(attributeMap(expandedItems(result)[0])).toMatchObject({
      _parent_product_gid: PARENT_PRODUCT_GID,
    });
  });

  it("treats invalid UUID metadata as legacy compatibility mode", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            ...productionMetadataAttributes({ bundleId: "not-a-uuid" }),
            builderEfiVariantId: attribute(EFI_FUSION_LITE),
            builderFuelVariantId: attribute(FUEL_TEST),
            builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
          }),
        ],
      },
    });

    expect(expandedItems(result)[0]).not.toHaveProperty("attributes");
  });

  it("treats missing UUID metadata as legacy compatibility mode", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            bundleSchemaVersion: attribute("1"),
            parentProductGid: attribute(PARENT_PRODUCT_GID),
            parentSku: attribute(PARENT_SKU),
            parentTitle: attribute(PARENT_TITLE),
            builderEfiVariantId: attribute(EFI_FUSION_LITE),
            builderFuelVariantId: attribute(FUEL_TEST),
            builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
          }),
        ],
      },
    });

    expect(expandedItems(result)[0]).not.toHaveProperty("attributes");
  });

  it("treats unsupported schema versions as legacy compatibility mode", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            ...productionMetadataAttributes({ bundleSchemaVersion: "2" }),
            builderEfiVariantId: attribute(EFI_FUSION_LITE),
            builderFuelVariantId: attribute(FUEL_TEST),
            builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
          }),
        ],
      },
    });

    expect(expandedItems(result)[0]).not.toHaveProperty("attributes");
  });

  it("keeps otherwise-identical bundle inputs independently identifiable by bundle id", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            id: "gid://shopify/CartLine/1",
            ...productionMetadataAttributes({ bundleId: BUNDLE_ID }),
            builderEfiVariantId: attribute(EFI_FUSION_LITE),
            builderFuelVariantId: attribute(FUEL_TEST),
            builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
          }),
          masterLine({
            id: "gid://shopify/CartLine/2",
            ...productionMetadataAttributes({ bundleId: SECOND_BUNDLE_ID }),
            builderEfiVariantId: attribute(EFI_FUSION_LITE),
            builderFuelVariantId: attribute(FUEL_TEST),
            builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
          }),
        ],
      },
    });

    expect(result.operations).toHaveLength(2);
    expect(attributeMap(result.operations[0].expand.expandedCartItems[0]))
      .toMatchObject({ _bundle_id: BUNDLE_ID });
    expect(attributeMap(result.operations[1].expand.expandedCartItems[0]))
      .toMatchObject({ _bundle_id: SECOND_BUNDLE_ID });
  });

  it("does not introduce lineUpdate operations", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            ...productionMetadataAttributes(),
            builderEfiVariantId: attribute(EFI_FUSION_LITE),
            builderFuelVariantId: attribute(FUEL_TEST),
            builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
          }),
        ],
      },
    });

    expect(result.operations).toEqual([
      expect.objectContaining({ expand: expect.any(Object) }),
    ]);
    expect(result.operations[0]).not.toHaveProperty("lineUpdate");
  });

  it("uses allow-listed Fuel Test 2 with whitespace for Advanced Build", () => {
    const result = run({
      cart: {
        lines: [
          masterLine({
            builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
            builderFuelVariantId: attribute(` ${FUEL_TEST_2} `),
            builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
            builderDisplayVariantId: attribute(DISPLAY_8_HD),
          }),
        ],
      },
    });

    expect(expandedItems(result)[1].merchandiseId).toBe(FUEL_TEST_2);
  });

  it("uses the real Function input shape from run.graphql", () => {
    const realFunctionInput = {
      cart: {
        lines: [
          {
            id: "gid://shopify/CartLine/e98e3787-6c6d-4b12-94d3-9989d56bc09d",
            quantity: 1,
            builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
            builderFuelVariantId: attribute(FUEL_TEST_2),
            builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
            builderDisplayVariantId: attribute(DISPLAY_8_HD),
            merchandise: {
              __typename: "ProductVariant",
              id: MASTER_KIT_VARIANT_ID,
              product: {
                id: PARENT_PRODUCT_GID,
              },
            },
          },
        ],
      },
    };

    const result = run(realFunctionInput);

    expect(result.operations[0].expand).toMatchObject({
      cartLineId:
        "gid://shopify/CartLine/e98e3787-6c6d-4b12-94d3-9989d56bc09d",
      title: "Master Kit Test",
    });
    expect(expandedItems(result).map((item) => item.merchandiseId)).toEqual([
      EFI_KILLSHOT_2_PRO,
      FUEL_TEST_2,
      IGNITION_HIGH_ROLLER,
      DISPLAY_8_HD,
    ]);
    expect(totalExpandedAmount(result)).toBe(202632);
  });
});
