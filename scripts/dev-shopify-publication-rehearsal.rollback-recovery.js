import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import {
  createPublicationAttempt,
  publishRevision,
  rollbackActiveRevision,
  transitionPublicationAttempt,
} from "../extensions/master-kit-expand/src/config/bundle-domain.lifecycle.js";
import {
  DEV_PUBLICATION_REHEARSAL_AT,
  createDevPublicationRehearsalExecution,
} from "./dev-shopify-publication-rehearsal.execution.js";
import { createExpectedDevPublicationBaselineRecovery } from "./dev-shopify-publication-rehearsal.recovery.js";
import { createExpectedDevPublicationCandidateRecovery } from "./dev-shopify-publication-rehearsal.candidate-recovery.js";

export class DevPublicationRollbackRecoveryError extends Error {
  constructor(message) {
    super(message);
    this.name = "DevPublicationRollbackRecoveryError";
  }
}

export function createDevPublicationRollbackRecovery(remote, runId) {
  const execution = createDevPublicationRehearsalExecution(runId);
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
  const rollbackDomain = rollbackActiveRevision({
    definition: candidateDomain.definition,
    revisions: candidateDomain.revisions,
    targetRevisionId: execution.identifiers.baselineRevisionId,
    updatedAt: DEV_PUBLICATION_REHEARSAL_AT,
  });
  const targetPublication = publication({
    execution,
    snapshotRef: reference(baselineSnapshot),
    domain: rollbackDomain,
  });

  assertIdentity(remote, execution.identifiers);
  assertExactPublication(
    remote.baselinePublication,
    createExpectedDevPublicationBaselineRecovery(runId).target.publication,
    "baseline",
  );
  assertExactPublication(
    remote.candidatePublication,
    createExpectedDevPublicationCandidateRecovery(runId).targetPublication,
    "candidate",
  );
  const snapshotState = classifySnapshot(remote.snapshot, baselineSnapshot, candidateSnapshot);
  const pointerState = classifyPointer(remote.activeRevision, execution.identifiers);
  const baselineRevisionState = classify(
    remote.baselineRevision,
    candidateDomain.revisions.find((revision) => revision.revision_id === execution.identifiers.baselineRevisionId),
    rollbackDomain.revisions.find((revision) => revision.revision_id === execution.identifiers.baselineRevisionId),
    "baseline revision",
  );
  const candidateRevisionState = classify(
    remote.candidateRevision,
    candidateDomain.revisions.find((revision) => revision.revision_id === execution.identifiers.candidateRevisionId),
    rollbackDomain.revisions.find((revision) => revision.revision_id === execution.identifiers.candidateRevisionId),
    "candidate revision",
  );
  const definitionState = classify(
    remote.definition,
    candidateDomain.definition,
    rollbackDomain.definition,
    "definition",
  );
  const publicationState = classifyOptional(remote.rollbackPublication, targetPublication);
  const domainIsCandidate = baselineRevisionState === "initial"
    && candidateRevisionState === "initial" && definitionState === "initial";
  const domainIsRollback = baselineRevisionState === "target"
    && candidateRevisionState === "target" && definitionState === "target";
  if (domainIsCandidate && publicationState === "absent"
      && snapshotState === "candidate" && pointerState === "candidate") {
    return stage("ready_to_stage_rollback_snapshot", execution, rollbackDomain, targetPublication, baselineSnapshot, {
      write_snapshot: true,
    });
  }
  if (domainIsCandidate && publicationState === "absent"
      && snapshotState === "baseline" && pointerState === "candidate") {
    return stage("ready_to_stage_rollback_pointer", execution, rollbackDomain, targetPublication, baselineSnapshot, {
      write_active_pointer: true,
    });
  }
  if (publicationState === "absent" && snapshotState === "baseline" && pointerState === "baseline") {
    if (domainIsCandidate) {
      return stage("ready_to_complete_rollback", execution, rollbackDomain, targetPublication, baselineSnapshot, {
        write_baseline_revision: true,
      });
    }
    if (baselineRevisionState === "target"
        && candidateRevisionState === "initial" && definitionState === "initial") {
      return stage("ready_to_complete_rollback", execution, rollbackDomain, targetPublication, baselineSnapshot, {
        write_candidate_revision: true,
      });
    }
    if (baselineRevisionState === "target"
        && candidateRevisionState === "target" && definitionState === "initial") {
      return stage("ready_to_complete_rollback", execution, rollbackDomain, targetPublication, baselineSnapshot, {
        write_definition: true,
      });
    }
    if (domainIsRollback) {
      return stage("ready_to_complete_rollback", execution, rollbackDomain, targetPublication, baselineSnapshot, {
        write_publication: true,
      });
    }
  }
  if (domainIsRollback && publicationState === "target"
      && snapshotState === "baseline" && pointerState === "baseline") {
    return stage("rollback_recovered", execution, rollbackDomain, targetPublication, baselineSnapshot, {});
  }
  throw new DevPublicationRollbackRecoveryError("remote rollback state is not an approved resumable state");
}

function stage(status, execution, domain, targetPublication, snapshot, steps) {
  return {
    status,
    identifiers: execution.identifiers,
    target: { domain, publication: targetPublication, snapshot },
    steps,
  };
}

function publication({ execution, snapshotRef, domain }) {
  const publicationId = execution.identifiers.rollbackPublicationId;
  let attempt = createPublicationAttempt({
    publicationId,
    revision: domain.revisions.find((revision) => revision.revision_id === execution.identifiers.baselineRevisionId),
    runtimeSnapshotRef: snapshotRef,
    previousActiveRevisionId: execution.identifiers.candidateRevisionId,
    attemptNumber: 1,
    createdAt: DEV_PUBLICATION_REHEARSAL_AT,
  });
  for (const nextState of ["compiled", "snapshot_written", "snapshot_verified", "active_pointer_updated", "recorded"]) {
    attempt = transitionPublicationAttempt(attempt, nextState, DEV_PUBLICATION_REHEARSAL_AT);
  }
  return {
    publication_attempt: attempt,
    result: {
      success: true,
      publication_id: publicationId,
      completed_steps: ["snapshot_written", "readback_verified", "active_pointer_updated", "previous_revision_superseded", "domain_persisted", "publication_recorded"],
      failed_step: null,
      compensation: { attempted: false, success: true, steps: [] },
      previous_active_revision_id: execution.identifiers.candidateRevisionId,
      active_revision_id: execution.identifiers.baselineRevisionId,
      snapshot_checksum: snapshotRef.checksum,
      warnings: ["recovered_partial_rehearsal"],
      domain,
      publication_attempt: attempt,
    },
    domain,
  };
}

function assertIdentity(remote, identifiers) {
  if (remote.definition?.bundle_definition_id !== identifiers.bundleDefinitionId
      || remote.baselineRevision?.revision_id !== identifiers.baselineRevisionId
      || remote.candidateRevision?.revision_id !== identifiers.candidateRevisionId
      || remote.baselineRevision?.bundle_definition_id !== identifiers.bundleDefinitionId
      || remote.candidateRevision?.bundle_definition_id !== identifiers.bundleDefinitionId) {
    throw new DevPublicationRollbackRecoveryError("rehearsal domain identity does not match");
  }
}

function assertExactPublication(actual, expected, label) {
  if (!same(actual, expected)) {
    throw new DevPublicationRollbackRecoveryError(`${label} is not the approved exact ${label} publication`);
  }
}

function classify(actual, initial, target, label) {
  if (same(actual, initial)) return "initial";
  if (same(actual, target)) return "target";
  throw new DevPublicationRollbackRecoveryError(`${label} differs from approved rollback states`);
}

function classifyOptional(actual, target) {
  if (actual === null) return "absent";
  if (same(actual, target)) return "target";
  throw new DevPublicationRollbackRecoveryError("rollback publication differs from the approved audit");
}

function classifySnapshot(carrier, baseline, candidate) {
  if (!carrier?.compareDigest) throw new DevPublicationRollbackRecoveryError("isolated Snapshot compareDigest is missing");
  if (carrier.document?.checksum === baseline.checksum) return "baseline";
  if (carrier.document?.checksum === candidate.checksum) return "candidate";
  throw new DevPublicationRollbackRecoveryError("isolated Snapshot differs from approved rollback states");
}

function classifyPointer(carrier, identifiers) {
  if (!carrier?.compareDigest) throw new DevPublicationRollbackRecoveryError("isolated active pointer compareDigest is missing");
  if (carrier.document === identifiers.baselineRevisionId) return "baseline";
  if (carrier.document === identifiers.candidateRevisionId) return "candidate";
  throw new DevPublicationRollbackRecoveryError("isolated active pointer differs from approved rollback states");
}

function reference(snapshot) {
  return {
    schema_version: snapshot.snapshot_schema,
    checksum_algorithm: snapshot.checksum_algorithm,
    checksum: snapshot.checksum,
    configuration_version: snapshot.configuration_version,
  };
}

function same(left, right) {
  return stableJson(left) === stableJson(right);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
