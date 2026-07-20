import { describe, expect, it } from "vitest";

import { run } from "./run.dev.prebuilt-metadata-lookup-static-probe.js";

describe("dev-only pre-built metadata/lookup + static hosted probe", () => {
  it("executes metadata and server lookup boundaries without changing static expansion", () => {
    const result = run({
      cart: {
        lines: [{
          id: "gid://shopify/CartLine/prebuilt",
          quantity: 1,
          bundleId: { value: "4af6d8b0-0427-49a1-8be7-270bb4132514" },
          bundleSchemaVersion: { value: "1" },
          parentProductGid: { value: "gid://shopify/Product/10627515777302" },
          parentVariantGid: { value: "gid://shopify/ProductVariant/51571819708694" },
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
