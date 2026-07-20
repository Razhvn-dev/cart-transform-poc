import { describe, expect, it } from "vitest";
import { createDeclarativePrebuiltBundleSourceAdapter } from "../../../extensions/master-kit-expand/src/config/prebuilt-bundle-import.declarative-source.js";
import { createPrebuiltBundleImportPackageFromSource } from "../../../extensions/master-kit-expand/src/config/prebuilt-bundle-import.source-package.js";
import { createPrebuiltBundleImportPlanFromPackage } from "../../../extensions/master-kit-expand/src/config/prebuilt-bundle-import.package.js";
import { createPrebuiltImportDemoData, PREBUILT_IMPORT_DEMO_NOTICE } from "./bundle-admin.prebuilt-import-demo";

describe("Bundle Admin synthetic pre-built import demo", () => {
  it("normalizes to one write-free record ready for review", async () => {
    const demo = createPrebuiltImportDemoData();
    const adapter = createDeclarativePrebuiltBundleSourceAdapter({
      profile: demo.source_mapping_profile,
      export_document: demo.raw_source_export,
    });
    const packageResult = await createPrebuiltBundleImportPackageFromSource({
      adapter,
      import_id: demo.import_id,
      mappings: demo.mappings,
      pilot_scope: demo.pilot_scope,
    });

    expect(demo.notice).toBe(PREBUILT_IMPORT_DEMO_NOTICE);
    expect(packageResult.ok).toBe(true);
    if (!packageResult.ok) throw new Error("Synthetic demo package must be valid");

    const plan = createPrebuiltBundleImportPlanFromPackage(packageResult.value);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("Synthetic demo plan must be valid");
    expect(plan.plan).toMatchObject({
      mode: "dry_run",
      requires_explicit_confirmation: true,
      summary: { total: 1, ready_for_confirmation: 1, needs_review: 0, rejected: 0 },
    });
  });

  it("returns independent data for repeat demonstrations", () => {
    const first = createPrebuiltImportDemoData();
    const second = createPrebuiltImportDemoData();
    first.raw_source_export.payload.bundles[0].external.id = "changed-locally";
    expect(second.raw_source_export.payload.bundles[0].external.id).toBe("demo-master-kit-001");
  });
});
