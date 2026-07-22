import { describe, expect, it } from "vitest";

import { createPrebuiltBundleImportPlanFromPackage } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.package.js";
import { importFixture } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.plan.test-fixture.js";
import { createDevCatalogTechnicalBatchExecutionManifest } from "./dev-catalog-technical-batch-execution-manifest.js";

const packageValue = importFixture();
const planned = createPrebuiltBundleImportPlanFromPackage(packageValue);
const definitionId = planned.plan.records[0].target.bundle_definition_id;
const importReview = { batch_id: "batch", package_fingerprint: planned.fingerprint, import_package: packageValue, plan: planned.plan };
const drafts = {
  batch_id: "batch",
  records: [{
    parent_sku: "PARENT",
    status: "draft_ready",
    draft: {
      definition: { bundle_definition_id: definitionId },
      revision: { revision_id: "10000000-0000-5000-8000-000000000001" },
    },
  }],
};
const collisions = { batch_id: "batch", summary: { blocked: 0 } };
const scope = { batch_id: "batch", draft_created_at: "2026-07-21T09:30:00.000Z", draft_created_by: "test" };

describe("development catalogue technical batch execution manifest", () => {
  it("freezes compiled IDs, checksums, recovery steps, and exact confirmation", () => {
    const first = createDevCatalogTechnicalBatchExecutionManifest({ importReview, drafts, collisions, scope });
    const second = createDevCatalogTechnicalBatchExecutionManifest({ importReview, drafts, collisions, scope });
    expect(first).toEqual(second);
    expect(first.exact_apply_confirmation).toBe(`APPLY_DEV_BATCH_${planned.plan.confirmation_token}`);
    expect(first.records[0]).toMatchObject({
      revision_id: "10000000-0000-5000-8000-000000000001",
      retry_policy: "RECONCILE_THEN_EXACT_RESUME",
    });
    expect(first.records[0].execution_steps).toHaveLength(9);
    expect(first.shopify_writes_performed).toBe(false);
  });

  it("fails closed when collision evidence is blocked", () => {
    expect(() => createDevCatalogTechnicalBatchExecutionManifest({
      importReview,
      drafts,
      collisions: { ...collisions, summary: { blocked: 1 } },
      scope,
    })).toThrow("collision readback is not clean");
  });

  it("fails closed for mismatched evidence batches", () => {
    expect(() => createDevCatalogTechnicalBatchExecutionManifest({
      importReview,
      drafts: { ...drafts, batch_id: "other" },
      collisions,
      scope,
    })).toThrow("execution evidence batch mismatch");
  });
});
