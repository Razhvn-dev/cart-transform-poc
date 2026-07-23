import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { createDevPublicationRehearsalExecution } from "./dev-shopify-publication-rehearsal.execution.js";
import { createDevPublicationRehearsalRecovery } from "./dev-shopify-publication-rehearsal.recovery.js";
import {
  DevPublicationCandidateRecoveryError,
  createDevPublicationCandidateRecovery,
} from "./dev-shopify-publication-rehearsal.candidate-recovery.js";

function baselineRemote() {
  const execution = createDevPublicationRehearsalExecution();
  const snapshot = compileRuntimeSnapshot(execution.baselineRevision.configuration);
  const partial = {
    definition: structuredClone(execution.definition),
    baselineRevision: structuredClone(execution.baselineRevision),
    candidateRevision: null,
    baselinePublication: null,
    candidatePublication: null,
    rollbackPublication: null,
    snapshot: { document: snapshot, compareDigest: "snapshot-digest" },
    activeRevision: { document: execution.identifiers.baselineRevisionId, compareDigest: "pointer-digest" },
  };
  const recovery = createDevPublicationRehearsalRecovery(partial);
  return {
    ...partial,
    definition: recovery.target.definition,
    baselineRevision: recovery.target.revision,
    baselinePublication: recovery.target.publication,
  };
}

describe("development publication rehearsal candidate recovery", () => {
  it("permits only an isolated candidate seed after the recovered baseline", () => {
    const plan = createDevPublicationCandidateRecovery(baselineRemote());
    expect(plan.status).toBe("needs_candidate_seed");
    expect(plan.steps).toEqual({ write_candidate_revision: true });
  });

  it("recognizes a seeded candidate that is ready for the normal publish orchestrator", () => {
    const remote = baselineRemote();
    const execution = createDevPublicationRehearsalExecution();
    remote.candidateRevision = execution.candidateRevision;

    expect(createDevPublicationCandidateRecovery(remote).status).toBe("ready_to_publish");
  });

  it("plans monotonic completion when only the candidate Snapshot was written", () => {
    const remote = baselineRemote();
    const execution = createDevPublicationRehearsalExecution();
    remote.candidateRevision = execution.candidateRevision;
    remote.snapshot.document = compileRuntimeSnapshot(execution.candidateRevision.configuration);

    expect(createDevPublicationCandidateRecovery(remote)).toMatchObject({
      status: "ready_to_complete_candidate",
      steps: { write_active_pointer: true },
    });
  });

  it("recognizes every one-write candidate domain intermediate state", () => {
    const remote = baselineRemote();
    const execution = createDevPublicationRehearsalExecution();
    remote.candidateRevision = execution.candidateRevision;
    remote.snapshot.document = compileRuntimeSnapshot(execution.candidateRevision.configuration);
    remote.activeRevision.document = execution.identifiers.candidateRevisionId;

    let plan = createDevPublicationCandidateRecovery(remote);
    expect(plan.steps).toEqual({ write_baseline_revision: true });

    remote.baselineRevision = structuredClone(plan.target.domain.revisions.find(
      (revision) => revision.revision_id === execution.identifiers.baselineRevisionId,
    ));
    plan = createDevPublicationCandidateRecovery(remote);
    expect(plan.steps).toEqual({ write_candidate_revision: true });

    remote.candidateRevision = structuredClone(plan.target.domain.revisions.find(
      (revision) => revision.revision_id === execution.identifiers.candidateRevisionId,
    ));
    plan = createDevPublicationCandidateRecovery(remote);
    expect(plan.steps).toEqual({ write_definition: true });

    remote.definition = structuredClone(plan.target.domain.definition);
    plan = createDevPublicationCandidateRecovery(remote);
    expect(plan.steps).toEqual({ write_publication: true });
  });

  it("rejects a pointer that was not created by the isolated stage", () => {
    const remote = baselineRemote();
    remote.activeRevision.document = "unexpected";

    expect(() => createDevPublicationCandidateRecovery(remote))
      .toThrow(DevPublicationCandidateRecoveryError);
  });

  it.each([
    ["missing", (remote) => { remote.baselinePublication = null; }],
    ["tampered", (remote) => { remote.baselinePublication.result.warnings = ["tampered"]; }],
  ])("requires the complete exact baseline PublicationRecord when it is %s", (_label, change) => {
    const remote = baselineRemote();
    change(remote);

    expect(() => createDevPublicationCandidateRecovery(remote))
      .toThrow(/recover:shopify-publication-rehearsal:dev/);
  });
});
