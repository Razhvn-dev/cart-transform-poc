import { describe, expect, it } from "vitest";

import { importFixture } from "./prebuilt-bundle-import.plan.test-fixture.js";
import { createPrebuiltBundleImportPlan } from "./prebuilt-bundle-import.plan.js";
import { createPrebuiltBundleRuntimeAssignments } from "./prebuilt-bundle-runtime.assignment.js";

function reviewedPlan() {
  const input = importFixture();
  return { plan: createPrebuiltBundleImportPlan(input), pilot_scope: input.pilot_scope };
}

describe("pre-built Bundle runtime assignments", () => {
  it("derives immutable assignments only from reviewed, pilot-approved records", () => {
    const { plan, pilot_scope } = reviewedPlan();
    const result = createPrebuiltBundleRuntimeAssignments({ import_plan: plan, pilot_scope });

    expect(result).toMatchObject({
      status: "ready",
      assignments: [expect.objectContaining({
        source_identity: "legacy_paid_app:legacy-master-kit-1",
        target_fingerprint: plan.records[0].target_fingerprint,
        bundle_definition_id: plan.records[0].target.bundle_definition_id,
        parent_variant_gid: plan.records[0].target.parent_binding.variant_gid,
        pilot_scope_id: pilot_scope.pilot_scope_id,
      })],
    });
    expect(Object.isFrozen(result.assignments[0])).toBe(true);
  });

  it("does not create assignments for rejected, out-of-scope, or duplicate reviewed records", () => {
    const { plan, pilot_scope } = reviewedPlan();
    const rejected = structuredClone(plan.records[0]);
    rejected.status = "rejected";
    const duplicate = structuredClone(plan.records[0]);
    duplicate.source_identity = "legacy_paid_app:another-source";
    const result = createPrebuiltBundleRuntimeAssignments({
      import_plan: { ...plan, records: [plan.records[0], rejected, duplicate] },
      pilot_scope,
    });
    expect(result.assignments).toHaveLength(1);
    expect(result.unavailable.map((item) => item.reason)).toEqual([
      "DUPLICATE_RUNTIME_ASSIGNMENT",
      "IMPORT_RECORD_NOT_READY",
    ]);

    const outOfScope = createPrebuiltBundleRuntimeAssignments({
      import_plan: plan,
      pilot_scope: { ...pilot_scope, approved_parent_variant_gids: ["gid://shopify/ProductVariant/999"] },
    });
    expect(outOfScope).toMatchObject({ status: "ready", assignments: [], unavailable: [expect.objectContaining({ reason: "PILOT_SCOPE_NOT_APPROVED" })] });
  });
});
