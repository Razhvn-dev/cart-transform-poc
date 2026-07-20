import { describe, expect, it } from "vitest";
import { createPrebuiltBundleImportPlanFromPackage } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.package.js";
import {
  DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS,
  DEV_PREBUILT_IMPORT_REHEARSAL_RUNS,
  assertDevPrebuiltImportRehearsalBindings,
  createDevPrebuiltImportRehearsalPackage,
} from "./dev-prebuilt-import-rehearsal.js";

const parent = {
  product_gid: "gid://shopify/Product/900000000001",
  variant_gid: "gid://shopify/ProductVariant/900000000002",
  sku: "REHEARSAL-PARENT",
  title: "Rehearsal Parent",
  template_handle: "rehearsal-parent",
};

describe("development pre-built import rehearsal", () => {
  it("uses only isolated metafield carriers", () => {
    expect(assertDevPrebuiltImportRehearsalBindings()).toBe(DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS);
    expect(Object.values(DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS.metafields).join(" "))
      .not.toContain("bundle_runtime_snapshot_v1");
  });

  it("builds a complete deterministic package that is ready for confirmation", () => {
    const packageValue = createDevPrebuiltImportRehearsalPackage({
      run: DEV_PREBUILT_IMPORT_REHEARSAL_RUNS.success,
      parent,
    });
    const result = createPrebuiltBundleImportPlanFromPackage(packageValue);
    expect(result).toMatchObject({ ok: true, plan: { summary: { ready_for_confirmation: 1 } } });
    expect(packageValue.mappings[0].configuration.parent).toMatchObject(parent);
  });
});
