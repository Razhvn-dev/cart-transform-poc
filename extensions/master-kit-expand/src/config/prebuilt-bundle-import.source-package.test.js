import { describe, expect, it } from "vitest";

import { createPrebuiltBundleImportPackageFromSource } from "./prebuilt-bundle-import.source-package.js";
import { createPrebuiltBundleImportSourceAdapter } from "./prebuilt-bundle-import.source-adapter.js";
import { importFixture } from "./prebuilt-bundle-import.plan.test-fixture.js";

describe("pre-built Bundle source package builder", () => {
  it("collects a read-only export into the existing validated package format", async () => {
    const fixture = importFixture();
    const adapter = createPrebuiltBundleImportSourceAdapter({
      source_system: fixture.source_records[0].source_system,
      async list_records() {
        return { records: fixture.source_records, next_cursor: null };
      },
    });

    const result = await createPrebuiltBundleImportPackageFromSource({
      adapter,
      import_id: fixture.import_id,
      mappings: fixture.mappings,
      pilot_scope: fixture.pilot_scope,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        import_id: fixture.import_id,
        source_export: {
          source_system: fixture.source_records[0].source_system,
          collection_mode: "read_only_pagination",
        },
      },
    });
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it("returns package validation errors without turning collection into a write", async () => {
    const fixture = importFixture();
    const adapter = createPrebuiltBundleImportSourceAdapter({
      source_system: fixture.source_records[0].source_system,
      async list_records() {
        return { records: fixture.source_records, next_cursor: null };
      },
    });

    const result = await createPrebuiltBundleImportPackageFromSource({
      adapter,
      import_id: fixture.import_id,
      mappings: null,
      pilot_scope: fixture.pilot_scope,
    });

    expect(result).toMatchObject({ ok: false, errors: expect.arrayContaining(["mappings must be an array."]) });
  });

  it("uses adapter-owned export provenance when the caller does not override it", async () => {
    const fixture = importFixture();
    const adapter = createPrebuiltBundleImportSourceAdapter({
      source_system: fixture.source_records[0].source_system,
      source_export: { source_system: fixture.source_records[0].source_system, raw_export_fingerprint: "abc12345" },
      async list_records() { return { records: fixture.source_records, next_cursor: null }; },
    });

    const result = await createPrebuiltBundleImportPackageFromSource({
      adapter,
      import_id: fixture.import_id,
      mappings: fixture.mappings,
      pilot_scope: fixture.pilot_scope,
    });

    expect(result.value.source_export.raw_export_fingerprint).toBe("abc12345");
  });
});
