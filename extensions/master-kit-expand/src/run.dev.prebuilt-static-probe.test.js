import { describe, expect, it } from "vitest";

import { run } from "./run.dev.prebuilt-static-probe.js";

describe("dev-only pre-built static hosted probe", () => {
  it("expands only the approved prebuilt test parent into three live imported components", () => {
    const result = run({
      cart: {
        lines: [{
          id: "gid://shopify/CartLine/prebuilt",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            id: "gid://shopify/ProductVariant/51571819708694",
            product: { id: "gid://shopify/Product/10627515777302" },
          },
        }],
      },
    });

    expect(result.operations).toEqual([{
      expand: {
        cartLineId: "gid://shopify/CartLine/prebuilt",
        title: "Prebuilt Bundle Test",
        expandedCartItems: [
          expect.objectContaining({ merchandiseId: "gid://shopify/ProductVariant/51592671756566" }),
          expect.objectContaining({ merchandiseId: "gid://shopify/ProductVariant/51592717566230" }),
          expect.objectContaining({ merchandiseId: "gid://shopify/ProductVariant/51592730706198" }),
        ],
      },
    }]);
    expect(result.operations[0].expand.expandedCartItems.map(
      (item) => item.price.adjustment.fixedPricePerUnit.amount,
    )).toEqual(["50.00", "30.00", "20.00"]);
  });

  it("leaves unrelated products unchanged", () => {
    const result = run({
      cart: {
        lines: [{
          id: "gid://shopify/CartLine/unrelated",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            id: "gid://shopify/ProductVariant/999",
            product: { id: "gid://shopify/Product/999" },
          },
        }],
      },
    });

    expect(result).toEqual({ operations: [] });
  });

  it("bisects the three- and four-component catalogue breadth parents with exact prices", () => {
    const result = run({
      cart: {
        lines: [
          probeLine("as2008c", "51592673329430"),
          probeLine("as2020ps", "51592717271318"),
        ],
      },
    });

    expect(result.operations.map(({ expand }) => ({
      cartLineId: expand.cartLineId,
      merchandiseIds: expand.expandedCartItems.map(({ merchandiseId }) => merchandiseId),
      prices: expand.expandedCartItems.map((item) => item.price.adjustment.fixedPricePerUnit.amount),
    }))).toEqual([
      {
        cartLineId: "gid://shopify/CartLine/as2008c",
        merchandiseIds: [
          "gid://shopify/ProductVariant/51592730706198",
          "gid://shopify/ProductVariant/51592666611990",
          "gid://shopify/ProductVariant/51592668217622",
        ],
        prices: ["24.13", "53.10", "62.76"],
      },
      {
        cartLineId: "gid://shopify/CartLine/as2020ps",
        merchandiseIds: [
          "gid://shopify/ProductVariant/51592668250390",
          "gid://shopify/ProductVariant/51592665825558",
          "gid://shopify/ProductVariant/51592715338006",
          "gid://shopify/ProductVariant/51552321175830",
        ],
        prices: ["170.61", "115.41", "100.36", "173.61"],
      },
    ]);
  });

  it("does not treat AF4005PK as a static probe after Projection promotion", () => {
    const result = run({
      cart: {
        lines: [{
          id: "gid://shopify/CartLine/af4005pk",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            id: "gid://shopify/ProductVariant/51592671789334",
            product: { id: "gid://shopify/Product/10638462877974" },
          },
        }],
      },
    });

    expect(result.operations).toEqual([]);
  });
});

function probeLine(id, variantId) {
  return {
    id: `gid://shopify/CartLine/${id}`,
    quantity: 1,
    merchandise: {
      __typename: "ProductVariant",
      id: `gid://shopify/ProductVariant/${variantId}`,
    },
  };
}
