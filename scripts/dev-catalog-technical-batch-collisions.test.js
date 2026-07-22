import { describe, expect, it } from "vitest";

import { assessDevCatalogTechnicalBatchCollisions } from "./dev-catalog-technical-batch-collisions.js";

const drafts = {
  batch_id: "batch",
  records: [
    { parent_sku: "NEW", status: "draft_ready", draft: { definition: { bundle_definition_id: "new-definition", parent_binding: { variant_gid: "new-parent" } } } },
    { parent_sku: "EXISTING", status: "existing_binding", draft: null },
  ],
};
const liveReadback = { records: [{ parent_sku: "EXISTING", parent: { live: { variant_gid: "existing-parent" } } }] };
const definitions = [{ bundle_definition_id: "existing-definition", slug: "existing", active_revision_id: "revision", parent_binding: { variant_gid: "existing-parent" } }];

describe("development catalogue technical batch collision readback", () => {
  it("accepts collision-free drafts and verifies one existing binding", () => {
    const report = assessDevCatalogTechnicalBatchCollisions({ drafts, liveReadback, definitions });
    expect(report.summary).toEqual({ total: 2, collision_free: 1, existing_binding_verified: 1, blocked: 0 });
    expect(report.shopify_writes_performed).toBe(false);
  });

  it("blocks proposed ID and parent ownership collisions", () => {
    const conflicting = [
      ...definitions,
      { bundle_definition_id: "new-definition", slug: "collision", active_revision_id: null, parent_binding: { variant_gid: "new-parent" } },
    ];
    const report = assessDevCatalogTechnicalBatchCollisions({ drafts, liveReadback, definitions: conflicting });
    expect(report.records[0].issues).toEqual(["PROPOSED_DEFINITION_ID_EXISTS", "PARENT_VARIANT_ALREADY_OWNED"]);
    expect(report.summary.blocked).toBe(1);
  });

  it("requires an existing binding to resolve exactly once", () => {
    const report = assessDevCatalogTechnicalBatchCollisions({ drafts, liveReadback, definitions: [] });
    expect(report.records[1].issues).toEqual(["EXISTING_BINDING_NOT_UNIQUE"]);
  });
});
