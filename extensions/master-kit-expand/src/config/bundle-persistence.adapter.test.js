import { describe, expect, it } from "vitest";
import { createInMemoryBundlePersistenceAdapter, invokeAdapter } from "./bundle-persistence.in-memory-adapter.js";
import { BundlePersistenceError } from "./bundle-persistence.adapter.js";
import { defineBundlePersistenceAdapterContract } from "./bundle-persistence.contract-test.js";

const definitionId = "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89";
const revisionOneId = "0a9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef701";
const revisionTwoId = "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702";
const previousSnapshot = { checksum: "1234abcd", configuration_version: 1 };
const targetSnapshot = { checksum: "5678abcd", configuration_version: 2 };

const fixture = {
  definition: {
    bundle_definition_id: definitionId,
    active_revision_id: revisionOneId,
  },
  revision: {
    revision_id: revisionOneId,
    bundle_definition_id: definitionId,
  },
  previousSnapshot,
  targetSnapshot,
  snapshotWrite: {
    bundle_definition_id: definitionId,
    expected_previous_snapshot_checksum: previousSnapshot.checksum,
    target_revision_id: revisionTwoId,
    target_snapshot_checksum: targetSnapshot.checksum,
    publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
    snapshot: targetSnapshot,
  },
  snapshotRestore: {
    bundle_definition_id: definitionId,
    expected_previous_snapshot_checksum: previousSnapshot.checksum,
    target_revision_id: revisionTwoId,
    target_snapshot_checksum: targetSnapshot.checksum,
    publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
    previous_snapshot: previousSnapshot,
  },
  pointerCas: {
    bundle_definition_id: definitionId,
    expected_active_revision_id: revisionOneId,
    target_revision_id: revisionTwoId,
    publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
  },
  publicationWrite: {
    publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
    record: { publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703", success: true },
  },
};

function createAdapter(options = {}) {
  return createInMemoryBundlePersistenceAdapter({
    definitions: [fixture.definition],
    revisions: [fixture.revision],
    snapshots: { [definitionId]: previousSnapshot },
    ...options,
  });
}

defineBundlePersistenceAdapterContract({ createAdapter, fixture });

describe("in-memory persistence adapter focused failures", () => {
  it("normalizes audit failures", () => {
    const adapter = createAdapter({ failures: { writePublicationRecord: new Error("audit unavailable") } });
    expect(() => adapter.writePublicationRecord(fixture.publicationWrite))
      .toThrow(expect.objectContaining({ code: "AUDIT_FAILED" }));
  });

  it("reports unsupported CAS capability", () => {
    const adapter = createAdapter({ capabilities: { active_revision_cas: false } });
    expect(() => adapter.compareAndSetActiveRevision(fixture.pointerCas))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_CAPABILITY" }));
  });

  it("uses normalized errors for adapter call boundaries", () => {
    const adapter = createAdapter({ failures: { writeRuntimeSnapshot: new Error("transport failure") } });
    expect(() => invokeAdapter(adapter, "writeRuntimeSnapshot", fixture.snapshotWrite, "WRITE_FAILED"))
      .toThrow(BundlePersistenceError);
    expect(() => invokeAdapter(adapter, "writeRuntimeSnapshot", fixture.snapshotWrite, "WRITE_FAILED"))
      .toThrow(expect.objectContaining({ code: "WRITE_FAILED" }));
  });
});
