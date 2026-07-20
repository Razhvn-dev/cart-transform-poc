import { describe, expect, it } from "vitest";
import {
  PREBUILT_BUNDLE_IMPORT_PACKAGE_SCHEMA_VERSION,
  createPrebuiltBundleImportPlanFromPackage,
  parsePrebuiltBundleImportPackage,
  serializePrebuiltBundleImportPackage,
} from "./prebuilt-bundle-import.package.js";
import { importFixture } from "./prebuilt-bundle-import.plan.test-fixture.js";

describe("pre-built Bundle import package", () => {
  it("accepts a canonical package and assigns a deterministic fingerprint", () => {
    const first = parsePrebuiltBundleImportPackage(importFixture());
    const second = parsePrebuiltBundleImportPackage(JSON.stringify(importFixture()));
    expect(first).toMatchObject({ ok: true, value: { schema_version: PREBUILT_BUNDLE_IMPORT_PACKAGE_SCHEMA_VERSION } });
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(Object.isFrozen(first.value)).toBe(true);
  });

  it("rejects malformed package shape and reserved bundle instance identifiers", () => {
    expect(parsePrebuiltBundleImportPackage("{")).toMatchObject({ ok: false });
    expect(parsePrebuiltBundleImportPackage({ schema_version: PREBUILT_BUNDLE_IMPORT_PACKAGE_SCHEMA_VERSION })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["import_id is required.", "source_records must be an array."]),
    });
    const packageWithReservedKey = importFixture();
    packageWithReservedKey.source_records[0]._bundle_id = "cart-instance";
    expect(parsePrebuiltBundleImportPackage(packageWithReservedKey).errors.join(" ")).toContain("_bundle_id is reserved");
  });

  it("delegates only valid canonical packages to the existing dry-run planner", () => {
    const result = createPrebuiltBundleImportPlanFromPackage(importFixture());
    expect(result).toMatchObject({ ok: true, plan: { mode: "dry_run", summary: { ready_for_confirmation: 1 } } });
    expect(createPrebuiltBundleImportPlanFromPackage({}).plan).toBeNull();
  });

  it("serializes a validated package deterministically", () => {
    const first = serializePrebuiltBundleImportPackage(importFixture());
    const second = serializePrebuiltBundleImportPackage(importFixture());
    expect(first).toBe(second);
  });
});
