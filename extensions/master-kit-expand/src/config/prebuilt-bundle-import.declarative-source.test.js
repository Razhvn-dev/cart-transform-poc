import { describe, expect, it } from "vitest";

import { collectPrebuiltBundleImportSourceRecords } from "./prebuilt-bundle-import.source-adapter.js";
import {
  PREBUILT_BUNDLE_SOURCE_MAPPING_SCHEMA_VERSION,
  createDeclarativePrebuiltBundleSourceAdapter,
  parseMappingProfile,
} from "./prebuilt-bundle-import.declarative-source.js";

const profile = {
  schema_version: PREBUILT_BUNDLE_SOURCE_MAPPING_SCHEMA_VERSION,
  source_system: "paid-bundles-export",
  records_path: "payload.bundles",
  fields: {
    source_bundle_id: "external.id",
    product_series_key: "series.key",
    parent_product_gid: "parent.product_gid",
    parent_variant_gid: "parent.variant_gid",
  },
  components: {
    path: "items",
    variant_gid: "shopify.variant_gid",
    quantity: "quantity",
  },
};

const rawExport = {
  payload: {
    bundles: [
      {
        external: { id: "bundle-a" },
        series: { key: "efi" },
        parent: {
          product_gid: "gid://shopify/Product/100",
          variant_gid: "gid://shopify/ProductVariant/101",
        },
        items: [{ shopify: { variant_gid: "gid://shopify/ProductVariant/201" }, quantity: 1 }],
      },
      {
        external: { id: "bundle-b" },
        series: { key: "efi" },
        parent: {
          product_gid: "gid://shopify/Product/110",
          variant_gid: "gid://shopify/ProductVariant/111",
        },
        items: [{ shopify: { variant_gid: "gid://shopify/ProductVariant/211" }, quantity: 1 }],
      },
    ],
  },
};

describe("declarative pre-built Bundle source adapter", () => {
  it("converts explicit object paths into paginated canonical records with provenance", async () => {
    const adapter = createDeclarativePrebuiltBundleSourceAdapter({ profile, export_document: rawExport });
    const records = await collectPrebuiltBundleImportSourceRecords({ adapter, page_size: 1 });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      schema_version: "prebuilt_bundle_import_source.v1",
      source_system: "paid-bundles-export",
      source_bundle_id: "bundle-a",
      product_series_key: "efi",
      parent_binding: { variant_gid: "gid://shopify/ProductVariant/101" },
      components: [{ variant_gid: "gid://shopify/ProductVariant/201", quantity: 1 }],
    });
    expect(records[0].source_checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(adapter.source_export).toMatchObject({
      collection_mode: "declarative_read_only_json_export",
      record_count: 2,
      mapping_schema_version: PREBUILT_BUNDLE_SOURCE_MAPPING_SCHEMA_VERSION,
    });
    expect(adapter.source_export.raw_export_fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(Object.isFrozen(adapter.source_export)).toBe(true);
  });

  it("uses an explicit vendor checksum when the profile supplies its path", async () => {
    const withChecksum = structuredClone(profile);
    withChecksum.fields.source_checksum = "external.checksum";
    const document = structuredClone(rawExport);
    document.payload.bundles[0].external.checksum = "vendor-checksum-a";
    document.payload.bundles[1].external.checksum = "vendor-checksum-b";

    const adapter = createDeclarativePrebuiltBundleSourceAdapter({ profile: withChecksum, export_document: document });
    const records = await collectPrebuiltBundleImportSourceRecords({ adapter });

    expect(records.map((record) => record.source_checksum)).toEqual(["vendor-checksum-a", "vendor-checksum-b"]);
  });

  it("fails closed on missing fields, duplicate IDs, and unsupported quantities", async () => {
    const missing = structuredClone(rawExport);
    delete missing.payload.bundles[0].parent.variant_gid;
    expect(() => createDeclarativePrebuiltBundleSourceAdapter({ profile, export_document: missing }))
      .toThrowError(expect.objectContaining({ code: "MISSING_SOURCE_FIELD" }));

    const duplicate = structuredClone(rawExport);
    duplicate.payload.bundles[1].external.id = "bundle-a";
    expect(() => createDeclarativePrebuiltBundleSourceAdapter({ profile, export_document: duplicate }))
      .toThrowError(expect.objectContaining({ code: "SOURCE_CONVERSION_FAILED" }));

    const unsupported = structuredClone(rawExport);
    unsupported.payload.bundles[0].items[0].quantity = 2;
    expect(() => createDeclarativePrebuiltBundleSourceAdapter({ profile, export_document: unsupported }))
      .toThrowError(expect.objectContaining({ code: "SOURCE_CONVERSION_FAILED" }));

    const numericId = structuredClone(rawExport);
    numericId.payload.bundles[0].parent.variant_gid = "101";
    expect(() => createDeclarativePrebuiltBundleSourceAdapter({ profile, export_document: numericId }))
      .toThrowError(expect.objectContaining({ code: "SOURCE_CONVERSION_FAILED" }));
  });

  it("rejects expression-like and prototype paths before reading source data", () => {
    expect(() => parseMappingProfile({ ...profile, records_path: "payload.bundles[0]" }))
      .toThrowError(expect.objectContaining({ code: "INVALID_MAPPING_PROFILE" }));
    expect(() => parseMappingProfile({
      ...profile,
      fields: { ...profile.fields, source_bundle_id: "__proto__.id" },
    })).toThrowError(expect.objectContaining({ code: "INVALID_MAPPING_PROFILE" }));
    expect(() => parseMappingProfile({ ...profile, unexpected_transform: "eval(record)" }))
      .toThrowError(expect.objectContaining({ code: "INVALID_MAPPING_PROFILE" }));
  });

  it("applies the record limit before converting the complete raw export", () => {
    expect(() => createDeclarativePrebuiltBundleSourceAdapter({
      profile,
      export_document: rawExport,
      max_records: 1,
    })).toThrowError(expect.objectContaining({ code: "MAX_RECORDS_EXCEEDED" }));
  });
});
