import { describe, expect, it } from "vitest";

import {
  DEV_PUBLICATION_REHEARSAL_RUN_ID,
  assertRehearsalOperationIsolated,
  buildDevPublicationRehearsalReconciliationQuery,
  buildStaleRehearsalSnapshotCasMutation,
  createDevPublicationRehearsalExecution,
  findStaleCasConflict,
  summarizeDevPublicationRehearsalReconciliation,
} from "./dev-shopify-publication-rehearsal.execution.js";

describe("development Shopify publication rehearsal execution", () => {
  it("builds an isolated two-revision domain without primary carrier keys", () => {
    const execution = createDevPublicationRehearsalExecution();

    expect(execution.identifiers.bundleDefinitionId).toBe(DEV_PUBLICATION_REHEARSAL_RUN_ID);
    expect(execution.definition.active_revision_id).toBeNull();
    expect(execution.baselineRevision.status).toBe("draft");
    expect(execution.candidateRevision.configuration.configuration_version).toBe(2);
    expect(execution.plan.isolation.bindings.runtimeSnapshotKey)
      .toBe("bundle_runtime_snapshot_publication_rehearsal_v1");
  });

  it("rejects primary and legacy carrier tokens from rehearsal operations", () => {
    expect(() => assertRehearsalOperationIsolated("bundle_runtime_snapshot_v1"))
      .toThrow(/forbidden token/);
    expect(() => assertRehearsalOperationIsolated("active_revision_id_v1"))
      .toThrow(/forbidden token/);
    expect(buildStaleRehearsalSnapshotCasMutation()).not.toContain("bundle_runtime_snapshot_v1");
    expect(buildDevPublicationRehearsalReconciliationQuery()).not.toContain("bundle_runtime_snapshot_v1");
  });

  it("reports only the reconciliation facts needed for recovery decisions", () => {
    expect(summarizeDevPublicationRehearsalReconciliation({
      definition: { fields: [{ key: "document", jsonValue: { active_revision_id: "baseline" } }] },
      baselineRevision: { fields: [{ key: "document", jsonValue: { status: "published" } }] },
      baselinePublication: {},
      candidateRevision: null,
      candidatePublication: null,
      rollbackPublication: null,
      product: {
        snapshot: { jsonValue: { checksum: "23143031" }, compareDigest: "snapshot-digest" },
        activeRevision: { value: "baseline", compareDigest: "pointer-digest" },
      },
    })).toEqual({
      definition_active_revision_id: "baseline",
      baseline_revision_status: "published",
      baseline_publication_exists: true,
      candidate_revision_exists: false,
      candidate_publication_exists: false,
      rollback_publication_exists: false,
      snapshot_checksum: "23143031",
      snapshot_compare_digest: "snapshot-digest",
      active_pointer: "baseline",
      active_pointer_compare_digest: "pointer-digest",
    });
  });

  it("accepts both Shopify stale-CAS conflict codes", () => {
    expect(findStaleCasConflict([{ code: "INVALID_COMPARE_DIGEST", message: "stale" }])?.code)
      .toBe("INVALID_COMPARE_DIGEST");
    expect(findStaleCasConflict([{ code: "STALE_OBJECT", message: "stale" }])?.code)
      .toBe("STALE_OBJECT");
    expect(findStaleCasConflict([{ code: "INVALID_VALUE", message: "bad" }])).toBeNull();
  });
});
