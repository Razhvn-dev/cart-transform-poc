import { describe, expect, it, vi } from "vitest";

import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { createDevPublicationRehearsalExecution } from "./dev-shopify-publication-rehearsal.execution.js";
import { createDevPublicationRehearsalRecovery } from "./dev-shopify-publication-rehearsal.recovery.js";
import { executeDevPublicationBaselineRecovery } from "./dev-shopify-publication-rehearsal.recovery-execution.js";

function partialRemote() {
  const execution = createDevPublicationRehearsalExecution();
  const snapshot = compileRuntimeSnapshot(execution.baselineRevision.configuration);
  return {
    execution,
    remote: {
      definition: structuredClone(execution.definition),
      baselineRevision: structuredClone(execution.baselineRevision),
      candidateRevision: null,
      baselinePublication: null,
      candidatePublication: null,
      rollbackPublication: null,
      snapshot: { document: snapshot, compareDigest: "snapshot-digest" },
      activeRevision: { document: execution.identifiers.baselineRevisionId, compareDigest: "pointer-digest" },
    },
  };
}

function harness() {
  const value = partialRemote();
  let remote = structuredClone(value.remote);
  const persistence = {
    writeRevision: vi.fn(async ({ revision }) => { remote.baselineRevision = structuredClone(revision); }),
    writeBundleDefinition: vi.fn(async ({ definition }) => { remote.definition = structuredClone(definition); }),
    writePublicationRecord: vi.fn(async ({ record }) => { remote.baselinePublication = structuredClone(record); }),
  };
  return {
    ...value,
    persistence,
    readRemote: async () => structuredClone(remote),
    getRemote: () => structuredClone(remote),
    setRemote: (next) => { remote = structuredClone(next); },
  };
}

describe("development publication baseline recovery execution", () => {
  it("performs exactly one independently reconciled mutation per invocation", async () => {
    const value = harness();
    const results = [];
    for (let invocation = 0; invocation < 3; invocation += 1) {
      results.push(await executeDevPublicationBaselineRecovery(value));
    }

    expect(results.map((result) => result.completed_steps[0])).toEqual([
      "baseline_revision_persisted",
      "definition_persisted",
      "publication_recorded",
    ]);
    expect(results.at(-1).status).toBe("baseline_recovered");
    expect(value.persistence.writeRevision).toHaveBeenCalledTimes(1);
    expect(value.persistence.writeBundleDefinition).toHaveBeenCalledTimes(1);
    expect(value.persistence.writePublicationRecord).toHaveBeenCalledTimes(1);
    expect(createDevPublicationRehearsalRecovery(value.getRemote()).status).toBe("already_recovered");
  });

  it("resumes after an ambiguous successful write without repeating it", async () => {
    const value = harness();
    value.persistence.writeRevision.mockImplementationOnce(async ({ revision }) => {
      const remote = value.getRemote();
      remote.baselineRevision = structuredClone(revision);
      value.setRemote(remote);
      throw new Error("socket hang up");
    });

    await expect(executeDevPublicationBaselineRecovery(value)).rejects.toThrow("socket hang up");
    await expect(executeDevPublicationBaselineRecovery(value)).resolves.toEqual({
      status: "ready_to_recover",
      completed_steps: ["definition_persisted"],
    });
    expect(value.persistence.writeRevision).toHaveBeenCalledTimes(1);
    expect(value.persistence.writeBundleDefinition).toHaveBeenCalledTimes(1);
  });
});
