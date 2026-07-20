import { describe, expect, it } from "vitest";

import { observePrebuiltBundleCartMetadata } from "./prebuilt-bundle-cart-metadata.observation.js";

const productId = "gid://shopify/Product/10600519598358";
const variantId = "gid://shopify/ProductVariant/51505325605142";
const bundleId = "4af6d8b0-0427-49a1-8be7-270bb4132514";

function line(overrides = {}) {
  return {
    id: "gid://shopify/CartLine/1",
    quantity: 1,
    bundleId: { value: bundleId },
    bundleSchemaVersion: { value: "1" },
    parentProductGid: { value: productId },
    parentVariantGid: { value: variantId },
    parentSku: { value: "MASTER-KIT-001" },
    parentTitle: { value: "Master Kit Test" },
    merchandise: { __typename: "ProductVariant", id: variantId, product: { id: productId } },
    ...overrides,
  };
}

describe("pre-built Bundle cart metadata observation", () => {
  it("accepts only correlation metadata that matches the actual cart merchandise", () => {
    const observed = observePrebuiltBundleCartMetadata(line());

    expect(observed).toEqual({
      status: "valid",
      reason: null,
      metadata: {
        bundle_instance_id: bundleId,
        schema_version: "1",
        parent_product_gid: productId,
        parent_variant_gid: variantId,
        parent_sku: "MASTER-KIT-001",
        parent_title: "Master Kit Test",
      },
    });
    expect(Object.isFrozen(observed)).toBe(true);
  });

  it("fails closed for missing, malformed, mismatched, or non-single metadata", () => {
    expect(observePrebuiltBundleCartMetadata(line({ id: "" }))).toMatchObject({ status: "invalid", reason: "CART_LINE_ID_MISSING" });
    expect(observePrebuiltBundleCartMetadata(line({ bundleId: null }))).toMatchObject({ status: "missing", reason: "BUNDLE_INSTANCE_ID_MISSING" });
    expect(observePrebuiltBundleCartMetadata(line({ bundleId: { value: "not-a-uuid" } }))).toMatchObject({ status: "invalid", reason: "BUNDLE_INSTANCE_ID_INVALID" });
    expect(observePrebuiltBundleCartMetadata(line({ parentVariantGid: { value: "gid://shopify/ProductVariant/999" } }))).toMatchObject({ status: "invalid", reason: "PARENT_VARIANT_MISMATCH" });
    expect(observePrebuiltBundleCartMetadata(line({ quantity: 2 }))).toMatchObject({ status: "invalid", reason: "BUNDLE_QUANTITY_NOT_SINGLE" });
  });

  it("supports the attribute-array shape used by local cart fixtures", () => {
    const queried = line({
      bundleId: undefined,
      bundleSchemaVersion: undefined,
      parentProductGid: undefined,
      parentVariantGid: undefined,
      parentSku: undefined,
      parentTitle: undefined,
      attributes: [
        { key: "_bundle_id", value: bundleId },
        { key: "_bundle_schema_version", value: "1" },
        { key: "_parent_product_gid", value: productId },
        { key: "_parent_variant_gid", value: variantId },
      ],
    });

    expect(observePrebuiltBundleCartMetadata(queried)).toMatchObject({ status: "valid" });
  });
});
