import { describe, expect, it } from "vitest";

import { run } from "./run.dev.prebuilt-parse-static-probe.js";

describe("dev-only pre-built parse + static hosted probe", () => {
  it("executes input extraction without changing the proven static expand", () => {
    const result = run({
      cart: {
        lines: [{
          id: "gid://shopify/CartLine/prebuilt",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            id: "gid://shopify/ProductVariant/51571819708694",
            product: {
              id: "gid://shopify/Product/10627515777302",
              prebuiltRuntimeMappingMetafield: null,
              prebuiltRuntimeSnapshotMetafield: null,
            },
          },
        }],
      },
    });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].expand.expandedCartItems).toHaveLength(3);
  });
});
