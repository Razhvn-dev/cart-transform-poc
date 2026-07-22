import { describe, expect, it } from "vitest";

import { masterKitConfigV1 } from "../extensions/master-kit-expand/src/config/fixtures/master-kit-config.v1.js";
import { prepareDevCatalogTechnicalBatchImportReview } from "./dev-catalog-technical-batch-import-review.js";

const configuration = structuredClone(masterKitConfigV1);
const drafts = {
  batch_id: "batch",
  records: [{
    parent_sku: "PARENT",
    status: "draft_ready",
    draft: {
      definition: {
        bundle_definition_id: configuration.configuration_id,
        parent_binding: { product_gid: configuration.parent.product_gid, variant_gid: configuration.parent.variant_gid },
      },
      revision: { configuration },
    },
  }],
};
const readiness = { batch_id: "batch", records: [{ parent_sku: "PARENT", evidence: { source_checksum: "source-checksum" } }] };
const collisions = { batch_id: "batch", summary: { blocked: 0 } };
const scope = {
  batch_id: "batch",
  draft_created_at: "2026-07-21T09:30:00.000Z",
  draft_created_by: "test-publisher",
  dev_product_series_assignments: { PARENT: "dev-series" },
};

describe("development catalogue technical batch import review", () => {
  it("builds a deterministic standard import package and ready dry-run plan", () => {
    const first = prepareDevCatalogTechnicalBatchImportReview({ drafts, readiness, collisions, scope });
    const second = prepareDevCatalogTechnicalBatchImportReview({ drafts, readiness, collisions, scope });
    expect(first).toEqual(second);
    expect(first.plan.summary).toEqual({ total: 1, ready_for_confirmation: 1, needs_review: 0, rejected: 0 });
    expect(first.import_package.pilot_scope.approved_product_series_keys).toEqual(["dev-series"]);
    expect(first.import_package.mappings[0].configuration).toMatchObject({
      status: "active",
      audit: { published_by: "test-publisher", published_at: "2026-07-21T09:30:00.000Z" },
    });
    expect(first.shopify_writes_performed).toBe(false);
  });

  it("requires explicit development series assignments", () => {
    expect(() => prepareDevCatalogTechnicalBatchImportReview({ drafts, readiness, collisions, scope: { batch_id: "batch" } }))
      .toThrow("development product series assignment required: PARENT");
  });

  it("refuses a batch with collision blockers", () => {
    expect(() => prepareDevCatalogTechnicalBatchImportReview({
      drafts,
      readiness,
      collisions: { ...collisions, summary: { blocked: 1 } },
      scope,
    })).toThrow("collision readback contains blocked records");
  });
});
