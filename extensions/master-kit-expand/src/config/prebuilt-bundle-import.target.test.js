import { describe, expect, it } from "vitest";

import { importFixture } from "./prebuilt-bundle-import.plan.test-fixture.js";
import { createPrebuiltBundleImportPlan } from "./prebuilt-bundle-import.plan.js";
import { compilePrebuiltBundleImportTarget } from "./prebuilt-bundle-import.target.js";

const REVISION_ID = "77770000-0000-4000-8000-000000000010";

function input() {
  const source = importFixture();
  const plan = createPrebuiltBundleImportPlan(source);
  return {
    record: plan.records[0],
    pilot_scope: source.pilot_scope,
    revision_id: REVISION_ID,
    created_at: "2026-07-20T00:00:00Z",
    created_by: "local-test",
  };
}

describe("pre-built import target compiler", () => {
  it("produces a complete published domain, assignment, Snapshot, and projection without writes", () => {
    const result = compilePrebuiltBundleImportTarget(input());

    expect(result).toMatchObject({
      status: "ready",
      definition: { active_revision_id: REVISION_ID },
      revision: { revision_id: REVISION_ID, status: "published" },
      assignment: { target_fingerprint: input().record.target_fingerprint },
      mapping: { published_revision_id: REVISION_ID },
      expand_projection: { published_revision_id: REVISION_ID },
    });
    expect(result.expand_projection.components).toHaveLength(3);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("refuses target content changed after review", () => {
    const value = input();
    value.record = structuredClone(value.record);
    value.record.target.configuration.parent.title = "Changed after confirmation";

    expect(compilePrebuiltBundleImportTarget(value)).toMatchObject({
      status: "unavailable",
      reason: "TARGET_FINGERPRINT_MISMATCH",
    });
  });

  it("refuses rejected records and invalid persistence identifiers", () => {
    const rejected = input();
    rejected.record = { ...rejected.record, status: "rejected" };
    expect(compilePrebuiltBundleImportTarget(rejected)).toMatchObject({ reason: "IMPORT_RECORD_NOT_READY" });

    expect(compilePrebuiltBundleImportTarget({ ...input(), revision_id: "invalid" })).toMatchObject({
      status: "unavailable",
      reason: "TARGET_DOCUMENTS_INVALID",
    });
  });
});
