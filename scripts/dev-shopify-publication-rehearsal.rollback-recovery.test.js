import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { publishRevision } from "../extensions/master-kit-expand/src/config/bundle-domain.lifecycle.js";
import {
  DEV_PUBLICATION_REHEARSAL_AT,
  createDevPublicationRehearsalExecution,
} from "./dev-shopify-publication-rehearsal.execution.js";
import { createExpectedDevPublicationBaselineRecovery } from "./dev-shopify-publication-rehearsal.recovery.js";
import { createDevPublicationCandidateRecovery } from "./dev-shopify-publication-rehearsal.candidate-recovery.js";
import {
  DevPublicationRollbackRecoveryError,
  createDevPublicationRollbackRecovery,
} from "./dev-shopify-publication-rehearsal.rollback-recovery.js";

export function partialRollbackRemote() {
  const execution = createDevPublicationRehearsalExecution();
  const baselineSnapshot = compileRuntimeSnapshot(execution.baselineRevision.configuration);
  const candidateSnapshot = compileRuntimeSnapshot(execution.candidateRevision.configuration);
  const baselineDomain = publishRevision({
    definition: execution.definition,
    revisions: [execution.baselineRevision],
    revisionId: execution.identifiers.baselineRevisionId,
    runtimeSnapshotRef: reference(baselineSnapshot),
    updatedAt: DEV_PUBLICATION_REHEARSAL_AT,
  });
  const candidateDomain = publishRevision({
    definition: baselineDomain.definition,
    revisions: [...baselineDomain.revisions, execution.candidateRevision],
    revisionId: execution.identifiers.candidateRevisionId,
    runtimeSnapshotRef: reference(candidateSnapshot),
    updatedAt: DEV_PUBLICATION_REHEARSAL_AT,
  });
  const baselinePublication = createExpectedDevPublicationBaselineRecovery().target.publication;
  const candidatePlan = createDevPublicationCandidateRecovery({
    definition: structuredClone(candidateDomain.definition),
    baselineRevision: structuredClone(candidateDomain.revisions[0]),
    candidateRevision: structuredClone(candidateDomain.revisions[1]),
    baselinePublication: structuredClone(baselinePublication),
    candidatePublication: null,
    rollbackPublication: null,
    snapshot: { document: candidateSnapshot, compareDigest: "candidate-snapshot-digest" },
    activeRevision: {
      document: execution.identifiers.candidateRevisionId,
      compareDigest: "candidate-pointer-digest",
    },
  });
  return {
    execution,
    remote: {
      definition: structuredClone(candidateDomain.definition),
      baselineRevision: structuredClone(candidateDomain.revisions[0]),
      candidateRevision: structuredClone(candidateDomain.revisions[1]),
      baselinePublication,
      candidatePublication: structuredClone(candidatePlan.target.publication),
      rollbackPublication: null,
      snapshot: { document: baselineSnapshot, compareDigest: "baseline-snapshot-digest" },
      activeRevision: { document: execution.identifiers.baselineRevisionId, compareDigest: "baseline-pointer-digest" },
    },
  };
}

describe("development publication rehearsal rollback recovery", () => {
  it("plans the isolated Snapshot as the first rollback carrier step", () => {
    const { remote, execution } = partialRollbackRemote();
    remote.snapshot.document = compileRuntimeSnapshot(execution.candidateRevision.configuration);
    remote.activeRevision.document = execution.identifiers.candidateRevisionId;
    expect(createDevPublicationRollbackRecovery(remote)).toMatchObject({
      status: "ready_to_stage_rollback_snapshot",
      steps: { write_snapshot: true },
    });
  });

  it("plans the isolated pointer only after the baseline Snapshot is verified", () => {
    const { remote, execution } = partialRollbackRemote();
    remote.activeRevision.document = execution.identifiers.candidateRevisionId;
    expect(createDevPublicationRollbackRecovery(remote)).toMatchObject({
      status: "ready_to_stage_rollback_pointer",
      steps: { write_active_pointer: true },
    });
  });

  it("plans only domain and audit completion after isolated carriers already rolled back", () => {
    const { remote } = partialRollbackRemote();
    expect(createDevPublicationRollbackRecovery(remote)).toMatchObject({
      status: "ready_to_complete_rollback",
      steps: { write_baseline_revision: true },
    });
  });

  it("recognizes every one-write rollback domain intermediate state", () => {
    const { remote, execution } = partialRollbackRemote();

    let plan = createDevPublicationRollbackRecovery(remote);
    expect(plan.steps).toEqual({ write_baseline_revision: true });

    remote.baselineRevision = structuredClone(plan.target.domain.revisions.find(
      (revision) => revision.revision_id === execution.identifiers.baselineRevisionId,
    ));
    plan = createDevPublicationRollbackRecovery(remote);
    expect(plan.steps).toEqual({ write_candidate_revision: true });

    remote.candidateRevision = structuredClone(plan.target.domain.revisions.find(
      (revision) => revision.revision_id === execution.identifiers.candidateRevisionId,
    ));
    plan = createDevPublicationRollbackRecovery(remote);
    expect(plan.steps).toEqual({ write_definition: true });

    remote.definition = structuredClone(plan.target.domain.definition);
    plan = createDevPublicationRollbackRecovery(remote);
    expect(plan.steps).toEqual({ write_publication: true });
  });

  it("rejects any carrier state other than the approved baseline", () => {
    const { remote } = partialRollbackRemote();
    remote.snapshot.document = { ...remote.snapshot.document, checksum: "unexpected" };
    expect(() => createDevPublicationRollbackRecovery(remote))
      .toThrow(DevPublicationRollbackRecoveryError);
  });

  it.each([
    ["baseline", (remote) => { remote.baselinePublication.result.warnings = ["tampered"]; }],
    ["candidate", (remote) => { remote.candidatePublication.domain.active_revision_id = "tampered"; }],
  ])("rejects a non-exact %s PublicationRecord", (_label, change) => {
    const { remote } = partialRollbackRemote();
    change(remote);
    expect(() => createDevPublicationRollbackRecovery(remote))
      .toThrow(/approved exact .* publication/i);
  });
});

function reference(snapshot) {
  return {
    schema_version: snapshot.snapshot_schema,
    checksum_algorithm: snapshot.checksum_algorithm,
    checksum: snapshot.checksum,
    configuration_version: snapshot.configuration_version,
  };
}
