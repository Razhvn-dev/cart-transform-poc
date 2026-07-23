import { expect, it } from "vitest";
import { compileRuntimeSnapshot } from "./config/bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./config/fixtures/master-kit-config.v1.js";
import { run as runProduction } from "./run.js";
import { run } from "./run.dev.stage7.js";

it("Stage 7 discards the comparison and returns the Shared Core result", () => {
  const input = {
    cart: {
      lines: [{
        id: "gid://shopify/CartLine/99",
        merchandise: {
          __typename: "ProductVariant",
          id: "gid://shopify/ProductVariant/51505325605142",
          product: {
            id: "gid://shopify/Product/10600519598358",
            runtimeSnapshotDevMetafield: {
              jsonValue: compileRuntimeSnapshot(masterKitConfigV1),
            },
          },
        },
        builderEfiVariantId: { value: "gid://shopify/ProductVariant/51592538587414" },
        builderFuelVariantId: { value: "gid://shopify/ProductVariant/51505348346134" },
        builderIgnitionVariantId: { value: "gid://shopify/ProductVariant/51592730706198" },
      }],
    },
  };

  expect(run(input)).toEqual(runProduction(input));
});
