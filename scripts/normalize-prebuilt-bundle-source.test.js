import { describe, expect, it } from "vitest";

import {
  normalizePrebuiltBundleSource,
  parseNormalizeSourceArguments,
} from "./normalize-prebuilt-bundle-source.mjs";

const mappingProfile = {
  schema_version: "prebuilt_bundle_source_mapping.v1",
  source_system: "paid-app",
  fields: {
    source_bundle_id: "id",
    product_series_key: "series",
    parent_product_gid: "parent_product_gid",
    parent_variant_gid: "parent_variant_gid",
  },
  components: { path: "components", variant_gid: "variant_gid", default_quantity: 1 },
};

describe("normalize pre-built Bundle source CLI", () => {
  it("normalizes a raw root array without creating a package or target mapping", async () => {
    const result = await normalizePrebuiltBundleSource({
      mappingProfile,
      exportDocument: [{
        id: "bundle-1",
        series: "efi",
        parent_product_gid: "gid://shopify/Product/1",
        parent_variant_gid: "gid://shopify/ProductVariant/2",
        components: [{ variant_gid: "gid://shopify/ProductVariant/3" }],
      }],
    });

    expect(result.source_records).toHaveLength(1);
    expect(result.source_export).toMatchObject({ source_system: "paid-app", record_count: 1 });
    expect(result).not.toHaveProperty("mappings");
    expect(result).not.toHaveProperty("pilot_scope");
  });

  it("accepts bounded read-only arguments and rejects write-like options", () => {
    expect(parseNormalizeSourceArguments([
      "--input", "raw.json", "--mapping", "mapping.json", "--page-size", "25", "--max-records", "500",
    ])).toEqual({ inputPath: "raw.json", mappingPath: "mapping.json", pageSize: 25, maxRecords: 500 });
    expect(() => parseNormalizeSourceArguments(["--apply"])).toThrow("read-only");
    expect(() => parseNormalizeSourceArguments(["--output", "normalized.json"])).toThrow("read-only");
    expect(() => parseNormalizeSourceArguments(["--input", "raw.json"])).toThrow("usage");
  });
});
