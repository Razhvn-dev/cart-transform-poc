import { describe, expect, it, vi } from "vitest";

import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { createDevPublicationRehearsalExecution } from "./dev-shopify-publication-rehearsal.execution.js";
import { createDevPublicationRehearsalRecovery } from "./dev-shopify-publication-rehearsal.recovery.js";
import { createDevPublicationCandidateRecovery } from "./dev-shopify-publication-rehearsal.candidate-recovery.js";
import { executeDevPublicationCandidateRecovery } from "./dev-shopify-publication-rehearsal.candidate-recovery-execution.js";

function candidateSnapshotRemote() {
  const execution = createDevPublicationRehearsalExecution();
  const baselineSnapshot = compileRuntimeSnapshot(execution.baselineRevision.configuration);
  const partial = {
    definition: structuredClone(execution.definition),
    baselineRevision: structuredClone(execution.baselineRevision),
    candidateRevision: structuredClone(execution.candidateRevision),
    baselinePublication: null,
    candidatePublication: null,
    rollbackPublication: null,
    snapshot: { document: baselineSnapshot, compareDigest: "baseline-snapshot-digest" },
    activeRevision: { document: execution.identifiers.baselineRevisionId, compareDigest: "baseline-pointer-digest" },
  };
  const baseline = createDevPublicationRehearsalRecovery({ ...partial, candidateRevision: null });
  partial.definition = baseline.target.definition;
  partial.baselineRevision = baseline.target.revision;
  partial.baselinePublication = baseline.target.publication;
  partial.snapshot.document = compileRuntimeSnapshot(execution.candidateRevision.configuration);
  return { execution, remote: partial };
}

describe("development publication candidate recovery execution", () => {
  it("plans no mutation when the exact baseline PublicationRecord is unavailable", async () => {
    const value = candidateSnapshotRemote();
    value.remote.baselinePublication.result.snapshot_checksum = "tampered";
    const persistence = {
      writeRuntimeSnapshot: vi.fn(),
      compareAndSetActiveRevision: vi.fn(),
      writeRevision: vi.fn(),
      writeBundleDefinition: vi.fn(),
      writePublicationRecord: vi.fn(),
    };

    await expect(executeDevPublicationCandidateRecovery({
      readRemote: async () => structuredClone(value.remote),
      persistence,
    })).rejects.toThrow(/recover:shopify-publication-rehearsal:dev/);
    for (const mutation of Object.values(persistence)) expect(mutation).not.toHaveBeenCalled();
  });

  it("stages the candidate Snapshot before monotonic completion", async () => {
    const value = candidateSnapshotRemote();
    value.remote.snapshot.document = compileRuntimeSnapshot(value.execution.baselineRevision.configuration);
    let remote = structuredClone(value.remote);
    const persistence = {
      writeRuntimeSnapshot: vi.fn(async ({ snapshot }) => { remote.snapshot.document = structuredClone(snapshot); }),
      compareAndSetActiveRevision: vi.fn(async ({ target_revision_id }) => { remote.activeRevision.document = target_revision_id; }),
      writeRevision: vi.fn(async ({ revision }) => {
        if (revision.revision_id === value.execution.identifiers.baselineRevisionId) remote.baselineRevision = structuredClone(revision);
        if (revision.revision_id === value.execution.identifiers.candidateRevisionId) remote.candidateRevision = structuredClone(revision);
      }),
      writeBundleDefinition: vi.fn(async ({ definition }) => { remote.definition = structuredClone(definition); }),
      writePublicationRecord: vi.fn(async ({ record }) => { remote.candidatePublication = structuredClone(record); }),
    };

    const result = await executeDevPublicationCandidateRecovery({
      readRemote: async () => structuredClone(remote),
      persistence,
    });

    expect(result).toEqual({
      status: "ready_to_complete_candidate",
      completed_steps: ["snapshot_written"],
    });
    expect(persistence.writeRuntimeSnapshot).toHaveBeenCalledTimes(1);
    expect(persistence.compareAndSetActiveRevision).not.toHaveBeenCalled();
    expect(persistence.writeRevision).not.toHaveBeenCalled();
    expect(persistence.writeBundleDefinition).not.toHaveBeenCalled();
    expect(persistence.writePublicationRecord).not.toHaveBeenCalled();
  });

  it("completes one independently reconciled candidate mutation per invocation", async () => {
    const value = candidateSnapshotRemote();
    let remote = structuredClone(value.remote);
    const persistence = {
      compareAndSetActiveRevision: vi.fn(async ({ target_revision_id }) => {
        remote.activeRevision.document = target_revision_id;
      }),
      writeRevision: vi.fn(async ({ revision }) => {
        if (revision.revision_id === value.execution.identifiers.baselineRevisionId) remote.baselineRevision = structuredClone(revision);
        if (revision.revision_id === value.execution.identifiers.candidateRevisionId) remote.candidateRevision = structuredClone(revision);
      }),
      writeBundleDefinition: vi.fn(async ({ definition }) => {
        remote.definition = structuredClone(definition);
      }),
      writePublicationRecord: vi.fn(async ({ record }) => {
        remote.candidatePublication = structuredClone(record);
      }),
      writeRuntimeSnapshot: vi.fn(),
    };

    const results = [];
    for (let invocation = 0; invocation < 5; invocation += 1) {
      results.push(await executeDevPublicationCandidateRecovery({
        readRemote: async () => structuredClone(remote),
        persistence,
      }));
    }

    expect(results.map((result) => result.completed_steps[0])).toEqual([
      "active_pointer_updated",
      "baseline_revision_persisted",
      "candidate_revision_persisted",
      "definition_persisted",
      "publication_recorded",
    ]);
    expect(results.at(-1).status).toBe("candidate_recovered");
    expect(persistence.writeRuntimeSnapshot).not.toHaveBeenCalled();
    expect(createDevPublicationCandidateRecovery(remote).status).toBe("candidate_recovered");
  });

  it("resumes after an ambiguous successful baseline revision write without repeating it", async () => {
    const value = candidateSnapshotRemote();
    let remote = structuredClone(value.remote);
    remote.activeRevision.document = value.execution.identifiers.candidateRevisionId;
    let ambiguous = true;
    const persistence = {
      compareAndSetActiveRevision: vi.fn(),
      writeRuntimeSnapshot: vi.fn(),
      writeRevision: vi.fn(async ({ revision }) => {
        if (revision.revision_id === value.execution.identifiers.baselineRevisionId) {
          remote.baselineRevision = structuredClone(revision);
          if (ambiguous) {
            ambiguous = false;
            throw new Error("socket hang up");
          }
        } else {
          remote.candidateRevision = structuredClone(revision);
        }
      }),
      writeBundleDefinition: vi.fn(),
      writePublicationRecord: vi.fn(),
    };

    await expect(executeDevPublicationCandidateRecovery({
      readRemote: async () => structuredClone(remote),
      persistence,
    })).rejects.toThrow("socket hang up");

    await expect(executeDevPublicationCandidateRecovery({
      readRemote: async () => structuredClone(remote),
      persistence,
    })).resolves.toEqual({
      status: "ready_to_complete_candidate",
      completed_steps: ["candidate_revision_persisted"],
    });
    expect(persistence.writeRevision.mock.calls.filter(
      ([{ revision }]) => revision.revision_id === value.execution.identifiers.baselineRevisionId,
    )).toHaveLength(1);
  });
});
