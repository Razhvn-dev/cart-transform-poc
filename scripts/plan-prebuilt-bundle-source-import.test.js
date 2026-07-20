import { describe, expect, it } from "vitest";

import { importFixture } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.plan.test-fixture.js";
import {
  parseSourceImportPlanArguments,
  planPrebuiltBundleSourceImport,
} from "./plan-prebuilt-bundle-source-import.mjs";

describe("raw source to pre-built Bundle plan", () => {
  it("creates a review-ready plan with raw-export provenance and no writes", async () => {
    const fixture = importFixture();
    const source = fixture.source_records[0];
    const result = await planPrebuiltBundleSourceImport({
      exportDocument: [{
        id: source.source_bundle_id,
        checksum: source.source_checksum,
        series: source.product_series_key,
        parent: source.parent_binding,
        components: source.components,
      }],
      mappingProfile: {
        schema_version: "prebuilt_bundle_source_mapping.v1",
        source_system: source.source_system,
        fields: {
          source_bundle_id: "id",
          source_checksum: "checksum",
          product_series_key: "series",
          parent_product_gid: "parent.product_gid",
          parent_variant_gid: "parent.variant_gid",
        },
        components: { path: "components", variant_gid: "variant_gid", quantity: "quantity" },
      },
      importId: fixture.import_id,
      mappings: fixture.mappings,
      pilotScope: fixture.pilot_scope,
    });

    expect(result).toMatchObject({
      ok: true,
      source_export: { record_count: 1, collection_mode: "declarative_read_only_json_export" },
      plan: { mode: "dry_run", summary: { ready_for_confirmation: 1, rejected: 0 } },
    });
    expect(result.package_fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("requires every explicit input and rejects execution options", () => {
    const args = [
      "--input", "raw.json",
      "--source-mapping", "source-map.json",
      "--target-mappings", "targets.json",
      "--pilot-scope", "pilot.json",
      "--import-id", "99990000-0000-4000-8000-000000000001",
    ];
    expect(parseSourceImportPlanArguments(args)).toMatchObject({ inputPath: "raw.json", sourceMappingPath: "source-map.json" });
    expect(() => parseSourceImportPlanArguments(["--execute"])).toThrow("read-only");
    expect(() => parseSourceImportPlanArguments(args.slice(0, -2))).toThrow("usage");
  });
});
