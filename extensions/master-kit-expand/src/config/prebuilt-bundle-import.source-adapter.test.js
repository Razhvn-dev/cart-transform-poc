import { describe, expect, it } from "vitest";

import {
  collectPrebuiltBundleImportSourceRecords,
  createPrebuiltBundleImportSourceAdapter,
} from "./prebuilt-bundle-import.source-adapter.js";
import { PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION } from "./prebuilt-bundle-import.plan.js";

function sourceRecord(sourceBundleId) {
  return {
    schema_version: PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION,
    source_system: "legacy-paid-app",
    source_bundle_id: sourceBundleId,
    source_checksum: `checksum-${sourceBundleId}`,
    product_series_key: "master-kit",
    parent_binding: {
      product_gid: "gid://shopify/Product/10600519598358",
      variant_gid: "gid://shopify/ProductVariant/51505325605142",
    },
    components: [{ variant_gid: "gid://shopify/ProductVariant/51505325605143", quantity: 1 }],
  };
}

describe("pre-built Bundle import source adapter", () => {
  it("collects all canonical pages in source order", async () => {
    const calls = [];
    const adapter = createPrebuiltBundleImportSourceAdapter({
      source_system: "legacy-paid-app",
      async list_records({ cursor, page_size }) {
        calls.push({ cursor, page_size });
        return cursor === null
          ? { records: [sourceRecord("source-a")], next_cursor: "page-2" }
          : { records: [sourceRecord("source-b")], next_cursor: null };
      },
    });

    const records = await collectPrebuiltBundleImportSourceRecords({ adapter, page_size: 25 });

    expect(records.map((record) => record.source_bundle_id)).toEqual(["source-a", "source-b"]);
    expect(calls).toEqual([{ cursor: null, page_size: 25 }, { cursor: "page-2", page_size: 25 }]);
    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records[0])).toBe(true);
  });

  it("rejects malformed canonical records before planning", async () => {
    const adapter = createPrebuiltBundleImportSourceAdapter({
      source_system: "legacy-paid-app",
      async list_records() {
        return { records: [{ ...sourceRecord("source-a"), source_system: "wrong-source" }], next_cursor: null };
      },
    });

    await expect(collectPrebuiltBundleImportSourceRecords({ adapter })).rejects.toMatchObject({
      name: "PrebuiltBundleImportSourceAdapterError",
      code: "SOURCE_SYSTEM_MISMATCH",
    });
  });

  it("preserves immutable source provenance without letting it affect pagination", () => {
    const adapter = createPrebuiltBundleImportSourceAdapter({
      source_system: "legacy-paid-app",
      source_export: { collection_mode: "read_only_file", record_count: 1 },
      async list_records() { return { records: [], next_cursor: null }; },
    });

    expect(adapter.source_export).toEqual({ collection_mode: "read_only_file", record_count: 1 });
    expect(Object.isFrozen(adapter.source_export)).toBe(true);
    expect(() => createPrebuiltBundleImportSourceAdapter({
      source_system: "legacy-paid-app",
      source_export: { source_system: "different-app" },
      async list_records() { return { records: [], next_cursor: null }; },
    })).toThrowError(expect.objectContaining({ code: "SOURCE_SYSTEM_MISMATCH" }));
  });

  it("stops repeated cursors and oversized exports", async () => {
    const repeatedCursorAdapter = createPrebuiltBundleImportSourceAdapter({
      source_system: "legacy-paid-app",
      async list_records() {
        return { records: [sourceRecord("source-a")], next_cursor: "same-page" };
      },
    });

    await expect(collectPrebuiltBundleImportSourceRecords({ adapter: repeatedCursorAdapter })).rejects.toMatchObject({
      name: "PrebuiltBundleImportSourceAdapterError",
      code: "REPEATED_CURSOR",
    });

    const oversizedAdapter = createPrebuiltBundleImportSourceAdapter({
      source_system: "legacy-paid-app",
      async list_records() {
        return { records: [sourceRecord("source-a"), sourceRecord("source-b")], next_cursor: null };
      },
    });

    await expect(collectPrebuiltBundleImportSourceRecords({ adapter: oversizedAdapter, max_records: 1 })).rejects.toMatchObject({
      name: "PrebuiltBundleImportSourceAdapterError",
      code: "MAX_RECORDS_EXCEEDED",
    });
  });
});
