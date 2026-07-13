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

function masterLine(attributes = {}) {
  return {
    id: "gid://shopify/CartLine/99",
    quantity: 1,
    merchandise: {
      __typename: "ProductVariant",
      id: MASTER_KIT_VARIANT_ID,
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
