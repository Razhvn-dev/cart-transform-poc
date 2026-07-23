import { describe, expect, it, vi } from "vitest";

import { executeDevPublicationRollbackRecovery } from "./dev-shopify-publication-rehearsal.rollback-recovery-execution.js";
import { createDevPublicationRollbackRecovery } from "./dev-shopify-publication-rehearsal.rollback-recovery.js";
import { partialRollbackRemote } from "./dev-shopify-publication-rehearsal.rollback-recovery.test.js";

describe("development publication rollback recovery execution", () => {
  it("completes one independently reconciled rollback mutation per invocation", async () => {
    const value = partialRollbackRemote();
    let remote = structuredClone(value.remote);
    const persistence = {
      writeRevision: vi.fn(async ({ revision }) => {
        if (revision.revision_id === value.execution.identifiers.baselineRevisionId) remote.baselineRevision = structuredClone(revision);
        if (revision.revision_id === value.execution.identifiers.candidateRevisionId) remote.candidateRevision = structuredClone(revision);
      }),
      writeBundleDefinition: vi.fn(async ({ definition }) => { remote.definition = structuredClone(definition); }),
      writePublicationRecord: vi.fn(async ({ record }) => { remote.rollbackPublication = structuredClone(record); }),
    };

    const results = [];
    for (let invocation = 0; invocation < 4; invocation += 1) {
      results.push(await executeDevPublicationRollbackRecovery({
        readRemote: async () => structuredClone(remote),
        persistence,
      }));
    }

    expect(results.map((result) => result.completed_steps[0])).toEqual([
      "baseline_revision_persisted",
      "candidate_revision_persisted",
      "definition_persisted",
      "publication_recorded",
    ]);
    expect(results.at(-1).status).toBe("rollback_recovered");
    expect(createDevPublicationRollbackRecovery(remote).status).toBe("rollback_recovered");
    expect(persistence).not.toHaveProperty("writeRuntimeSnapshot");
    expect(persistence).not.toHaveProperty("compareAndSetActiveRevision");
  });

  it("resumes after an ambiguous successful baseline revision rollback without repeating it", async () => {
    const value = partialRollbackRemote();
    let remote = structuredClone(value.remote);
    let ambiguous = true;
    const persistence = {
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

    await expect(executeDevPublicationRollbackRecovery({
      readRemote: async () => structuredClone(remote),
      persistence,
    })).rejects.toThrow("socket hang up");

    await expect(executeDevPublicationRollbackRecovery({
      readRemote: async () => structuredClone(remote),
      persistence,
    })).resolves.toEqual({
      status: "ready_to_complete_rollback",
      completed_steps: ["candidate_revision_persisted"],
    });
    expect(persistence.writeRevision.mock.calls.filter(
      ([{ revision }]) => revision.revision_id === value.execution.identifiers.baselineRevisionId,
    )).toHaveLength(1);
  });
});
