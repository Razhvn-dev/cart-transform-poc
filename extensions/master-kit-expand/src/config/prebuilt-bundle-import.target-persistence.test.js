import { describe, expect, it } from "vitest";

import { createInMemoryBundlePersistenceAdapter } from "./bundle-persistence.in-memory-adapter.js";
import { importFixture } from "./prebuilt-bundle-import.plan.test-fixture.js";
import { createPrebuiltBundleImportPlan } from "./prebuilt-bundle-import.plan.js";
import { createInMemoryPrebuiltBundleImportLedger, executeConfirmedPrebuiltBundleImport } from "./prebuilt-bundle-import.execution.js";
import { compilePrebuiltBundleImportTarget } from "./prebuilt-bundle-import.target.js";
import { createPrebuiltBundleImportTargetWriter, persistPrebuiltBundleImportTarget } from "./prebuilt-bundle-import.target-persistence.js";

const REVISION_ID = "77770000-0000-4000-8000-000000000010";
const PUBLICATION_ID = "77770000-0000-4000-8000-000000000011";

function fixture() {
  const source = importFixture();
  const plan = createPrebuiltBundleImportPlan(source);
  const record = plan.records[0];
  const compiled = compilePrebuiltBundleImportTarget({
    record,
    pilot_scope: source.pilot_scope,
    revision_id: REVISION_ID,
    created_at: "2026-07-20T00:00:00Z",
    created_by: "local-test",
  });
  return {
    input: {
      compiled_target: compiled,
      import_id: plan.import_id,
      publication_id: PUBLICATION_ID,
      source_identity: record.source_identity,
      source_fingerprint: record.source_fingerprint,
      target_fingerprint: record.target_fingerprint,
      at: "2026-07-20T00:00:00Z",
    },
    compiled,
  };
}

describe("pre-built import target persistence", () => {
  it("persists and activates the complete target in a recoverable order", async () => {
    const { input, compiled } = fixture();
    const persistence = createInMemoryBundlePersistenceAdapter();
    const result = await persistPrebuiltBundleImportTarget(input, { persistence });

    expect(result).toMatchObject({ success: true, recovery_required: false });
    expect(result.completed_steps).toEqual([
      "definition_staged", "revision_written", "snapshot_written", "projection_written",
      "active_pointer_updated", "definition_activated", "audit_recorded",
    ]);
    expect(persistence.state.definitionStore.get(compiled.definition.bundle_definition_id).active_revision_id)
      .toBe(REVISION_ID);
    expect(persistence.state.snapshotStore.get(compiled.definition.bundle_definition_id).checksum)
      .toBe(compiled.snapshot.checksum);
    expect(persistence.state.projectionStore.get(compiled.definition.bundle_definition_id).checksum)
      .toBe(compiled.expand_projection.checksum);
  });

  it("is idempotent after completion and resumes exact partial state", async () => {
    const { input, compiled } = fixture();
    const staged = { ...compiled.definition, active_revision_id: null };
    const persistence = createInMemoryBundlePersistenceAdapter({
      definitions: [staged],
      revisions: [compiled.revision],
      snapshots: { [compiled.definition.bundle_definition_id]: compiled.snapshot },
    });

    const completed = await persistPrebuiltBundleImportTarget(input, { persistence });
    const retry = await persistPrebuiltBundleImportTarget(input, { persistence });
    expect(completed.success).toBe(true);
    expect(retry).toMatchObject({ success: true, idempotent_retry: true });
  });

  it("fails closed on partial-state drift", async () => {
    const { input, compiled } = fixture();
    const persistence = createInMemoryBundlePersistenceAdapter({
      definitions: [{ ...compiled.definition, active_revision_id: null, slug: "different" }],
    });

    await expect(persistPrebuiltBundleImportTarget(input, { persistence })).rejects.toMatchObject({
      code: "RETRY_CONFLICT",
      details: { recovery_required: false },
    });
  });

  it("reports resumable recovery evidence after the first successful write", async () => {
    const { input } = fixture();
    const persistence = createInMemoryBundlePersistenceAdapter({
      failures: { writeRevision: new Error("revision unavailable") },
    });

    await expect(persistPrebuiltBundleImportTarget(input, { persistence })).rejects.toMatchObject({
      details: {
        completed_steps: ["definition_staged"],
        recovery_required: true,
        recovery_strategy: "EXACT_RETRY_OR_MANUAL_RECONCILIATION",
      },
    });
  });

  it("connects confirmed import execution to the resumable target writer", async () => {
    const source = importFixture();
    const plan = createPrebuiltBundleImportPlan(source);
    const persistence = createInMemoryBundlePersistenceAdapter();
    const ids = [REVISION_ID, PUBLICATION_ID];
    const writer = createPrebuiltBundleImportTargetWriter({
      persistence,
      pilot_scope: source.pilot_scope,
      id_factory: () => ids.shift(),
      now: () => "2026-07-20T00:00:00Z",
      created_by: "local-test",
    });

    const result = await executeConfirmedPrebuiltBundleImport({
      plan,
      confirmation_token: plan.confirmation_token,
      ledger: createInMemoryPrebuiltBundleImportLedger(),
      create_target: writer,
      now: () => "2026-07-20T00:00:00Z",
    });

    expect(result).toMatchObject({ completed: 1, failed: 0 });
    expect(persistence.state.definitionStore.get(plan.records[0].target.bundle_definition_id).active_revision_id)
      .toBe(REVISION_ID);
  });
});
