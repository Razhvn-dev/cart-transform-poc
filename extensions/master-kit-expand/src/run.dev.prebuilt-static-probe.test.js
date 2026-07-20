import { describe, expect, it } from "vitest";

import { run } from "./run.dev.prebuilt-static-probe.js";

describe("dev-only pre-built static hosted probe", () => {
  it("expands only the approved prebuilt test parent into the observed three components", () => {
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
          expect.objectContaining({ merchandiseId: "gid://shopify/ProductVariant/51552319766806" }),
          expect.objectContaining({ merchandiseId: "gid://shopify/ProductVariant/51505348346134" }),
          expect.objectContaining({ merchandiseId: "gid://shopify/ProductVariant/51552321011990" }),
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
});
