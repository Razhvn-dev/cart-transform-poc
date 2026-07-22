import { describe, expect, it } from "vitest";

import { run } from "./run.dev.prebuilt-projection-diagnostic-static-probe.js";

const AS2008C_PROJECTION = Object.freeze({
  schema_version: "prebuilt_bundle_expand_projection.v1",
  checksum_algorithm: "fnv1a-32",
  bundle_definition_id: "fb632869-fac3-5023-a162-e5d9e7944bc9",
  published_revision_id: "2b6e7db8-397e-5cf8-aa9b-64d7bd339579",
  source_snapshot_checksum: "11907353",
  parent: {
    product_gid: "gid://shopify/Product/10638463205654",
    variant_gid: "gid://shopify/ProductVariant/51592673329430",
    sku: "AS2008C",
    title: "High Roller (Classic)",
  },
  components: [
    {
      sequence: 1,
      group: "component_01_ac2008",
      role: "fixed_component",
      product_gid: "gid://shopify/Product/10620891988246",
      variant_gid: "gid://shopify/ProductVariant/51592730706198",
      sku: "AC2008",
      title: "Black Jack Pro Series Ignition Coils",
      fixed_price_per_unit: "24.13",
    },
    {
      sequence: 2,
      group: "component_02_ah2008c",
      role: "fixed_component",
      product_gid: "gid://shopify/Product/10638462615830",
      variant_gid: "gid://shopify/ProductVariant/51592666611990",
      sku: "AH2008C",
      title: "High Roller Classic / Full System Harness",
      fixed_price_per_unit: "53.10",
    },
    {
      sequence: 3,
      group: "component_03_ae2008c",
      role: "fixed_component",
      product_gid: "gid://shopify/Product/10638462714134",
      variant_gid: "gid://shopify/ProductVariant/51592668217622",
      sku: "AE2008C",
      title: "High Roller Classic",
      fixed_price_per_unit: "62.76",
    },
  ],
  checksum: "42dd44b6",
});

describe("dev-only observable Projection diagnostic probe", () => {
  it("executes a ready candidate but returns only the proven static payload with an observable status title", () => {
    const result = run({ cart: { lines: [line(AS2008C_PROJECTION)] } });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].expand).toMatchObject({
      cartLineId: "gid://shopify/CartLine/as2008c",
      title: "High Roller (Classic) [projection:ready:1:1]",
    });
    expect(result.operations[0].expand.expandedCartItems).toHaveLength(3);
    expect(result.operations[0].expand.expandedCartItems.every(
      (item) => item.attributes == null,
    )).toBe(true);
  });

  it("keeps the static payload observable when the hosted Projection metafield is unavailable", () => {
    const result = run({ cart: { lines: [line(null)] } });

    expect(result.operations[0].expand.title)
      .toBe("High Roller (Classic) [projection:unavailable:0:0]");
  });
});

function line(projection) {
  return {
    id: "gid://shopify/CartLine/as2008c",
    quantity: 1,
    cost: { amountPerQuantity: { amount: "139.99" } },
    bundleId: { value: "906ec234-e2b5-4bc9-a13f-a2dfedfa7694" },
    bundleSchemaVersion: { value: "1" },
    parentProductGid: { value: AS2008C_PROJECTION.parent.product_gid },
    parentVariantGid: { value: AS2008C_PROJECTION.parent.variant_gid },
    parentSku: { value: AS2008C_PROJECTION.parent.sku },
    parentTitle: { value: AS2008C_PROJECTION.parent.title },
    merchandise: {
      __typename: "ProductVariant",
      id: AS2008C_PROJECTION.parent.variant_gid,
      product: {
        id: AS2008C_PROJECTION.parent.product_gid,
        prebuiltExpandProjectionMetafield: projection == null ? null : { jsonValue: projection },
      },
    },
  };
}
