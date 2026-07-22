import { describe, expect, it } from "vitest";

import { calculateStableValueChecksum } from "./config/bundle-runtime.checksum.js";
import { run } from "./run.dev.prebuilt-projection-promotion-bypass-bisect.js";

describe("dev-only Projection promotion-bypass bisect", () => {
  it("returns the complete candidate operation directly with component attributes", () => {
    const result = run({ cart: { lines: [projectionLine()] } });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].expand).toMatchObject({
      cartLineId: "gid://shopify/CartLine/projection-bypass",
      title: "Projection Bypass Parent",
      expandedCartItems: [{
        merchandiseId: "gid://shopify/ProductVariant/200",
        quantity: 1,
        price: { adjustment: { fixedPricePerUnit: { amount: "10.00" } } },
      }],
    });
    expect(Object.fromEntries(
      result.operations[0].expand.expandedCartItems[0].attributes
        .map(({ key, value }) => [key, value]),
    )).toMatchObject({
      _bundle_id: "906ec234-e2b5-4bc9-a13f-a2dfedfa7694",
      _component_sequence: "1",
    });
  });

  it("falls back to Shared Core when no complete Projection candidate exists", () => {
    expect(run({
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
    })).toEqual({ operations: [] });
  });
});

function projectionLine() {
  const body = {
    schema_version: "prebuilt_bundle_expand_projection.v1",
    checksum_algorithm: "fnv1a-32",
    bundle_definition_id: "77770000-0000-4000-8000-000000000001",
    published_revision_id: "77770000-0000-4000-8000-000000000002",
    source_snapshot_checksum: "12345678",
    parent: {
      product_gid: "gid://shopify/Product/100",
      variant_gid: "gid://shopify/ProductVariant/100",
      sku: "BYPASS-PARENT",
      title: "Projection Bypass Parent",
    },
    components: [{
      sequence: 1,
      group: "component_01",
      role: "fixed_component",
      product_gid: "gid://shopify/Product/200",
      variant_gid: "gid://shopify/ProductVariant/200",
      sku: "BYPASS-COMPONENT",
      title: "Projection Bypass Component",
      fixed_price_per_unit: "10.00",
    }],
  };
  const projection = { ...body, checksum: calculateStableValueChecksum(body) };

  return {
    id: "gid://shopify/CartLine/projection-bypass",
    quantity: 1,
    cost: { amountPerQuantity: { amount: "10.00" } },
    bundleId: { value: "906ec234-e2b5-4bc9-a13f-a2dfedfa7694" },
    bundleSchemaVersion: { value: "1" },
    parentProductGid: { value: projection.parent.product_gid },
    parentVariantGid: { value: projection.parent.variant_gid },
    parentSku: { value: projection.parent.sku },
    parentTitle: { value: projection.parent.title },
    merchandise: {
      __typename: "ProductVariant",
      id: projection.parent.variant_gid,
      product: {
        id: projection.parent.product_gid,
        prebuiltExpandProjectionMetafield: { jsonValue: projection },
      },
    },
  };
}
