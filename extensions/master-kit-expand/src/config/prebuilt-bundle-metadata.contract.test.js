import { describe, expect, it } from "vitest";

import {
  PREBUILT_BUNDLE_METADATA_SCHEMA_VERSION,
  createPrebuiltBundleCartMetadata,
  validatePrebuiltBundleCartMetadataInput,
} from "./prebuilt-bundle-metadata.contract.js";

const parent = {
  product_gid: "gid://shopify/Product/10600519598358",
  variant_gid: "gid://shopify/ProductVariant/51505325605142",
  sku: "MASTER-KIT-001",
  title: "Master Kit Test",
};

const instanceId = "4af6d8b0-0427-49a1-8be7-270bb4132514";

describe("pre-built Bundle cart metadata contract", () => {
  it("creates only Bundle Metadata V1 correlation fields", () => {
    const result = createPrebuiltBundleCartMetadata({ bundle_instance_id: instanceId, parent });

    expect(result).toEqual({
      ok: true,
      errors: [],
      properties: {
        _bundle_id: instanceId,
        _bundle_schema_version: PREBUILT_BUNDLE_METADATA_SCHEMA_VERSION,
        _parent_product_gid: parent.product_gid,
        _parent_variant_gid: parent.variant_gid,
        _parent_sku: parent.sku,
        _parent_title: parent.title,
      },
    });
    expect(Object.isFrozen(result.properties)).toBe(true);
    expect(Object.keys(result.properties)).not.toEqual(expect.arrayContaining([
      "fixed_selections",
      "component_variant_gids",
      "snapshot_checksum",
      "price",
    ]));
  });

  it("keeps two normal-product adds independently identifiable", () => {
    const first = createPrebuiltBundleCartMetadata({ bundle_instance_id: instanceId, parent });
    const second = createPrebuiltBundleCartMetadata({
      bundle_instance_id: "bfc2c6e6-1600-4f48-9fd8-d2018e080ec3",
      parent,
    });

    expect(first.properties._bundle_id).not.toBe(second.properties._bundle_id);
    expect(first.properties._parent_variant_gid).toBe(second.properties._parent_variant_gid);
  });

  it("rejects malformed IDs and parent identifiers without returning properties", () => {
    const result = createPrebuiltBundleCartMetadata({
      bundle_instance_id: "not-a-uuid",
      parent: { ...parent, variant_gid: "wrong" },
    });

    expect(result).toMatchObject({ ok: false, properties: null });
    expect(result.errors).toEqual(expect.arrayContaining([
      "bundle_instance_id must be a UUID",
      "parent.variant_gid has invalid format",
    ]));
    expect(validatePrebuiltBundleCartMetadataInput({ bundle_instance_id: instanceId, parent })).toEqual([]);
  });
});
