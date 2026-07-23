import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import {
  createPublicationAttempt,
  publishRevision,
  transitionPublicationAttempt,
} from "../extensions/master-kit-expand/src/config/bundle-domain.lifecycle.js";
import { DEV_PUBLICATION_REHEARSAL_AT, createDevPublicationRehearsalExecution } from "./dev-shopify-publication-rehearsal.execution.js";
import { createExpectedDevPublicationBaselineRecovery } from "./dev-shopify-publication-rehearsal.recovery.js";

export class DevPublicationCandidateRecoveryError extends Error {
  constructor(message) {
    super(message);
    this.name = "DevPublicationCandidateRecoveryError";
  }
}

// Maps the only permitted remote states for the isolated candidate stage.
// It intentionally refuses to infer a compensation action from an unknown
// carrier or domain state.
export function createExpectedDevPublicationCandidateRecovery(runId) {
  const execution = createDevPublicationRehearsalExecution(runId);
  const baselineSnapshot = compileRuntimeSnapshot(execution.baselineRevision.configuration);
  const candidateSnapshot = compileRuntimeSnapshot(execution.candidateRevision.configuration);
  const baselineRef = reference(baselineSnapshot);
  const candidateRef = reference(candidateSnapshot);
  const baselineDomain = publishRevision({
    definition: execution.definition,
    revisions: [execution.baselineRevision],
    revisionId: execution.identifiers.baselineRevisionId,
    runtimeSnapshotRef: baselineRef,
    updatedAt: DEV_PUBLICATION_REHEARSAL_AT,
  });
  const candidateDomain = publishRevision({
    definition: baselineDomain.definition,
    revisions: [...baselineDomain.revisions, execution.candidateRevision],
    revisionId: execution.identifiers.candidateRevisionId,
    runtimeSnapshotRef: candidateRef,
    updatedAt: DEV_PUBLICATION_REHEARSAL_AT,
  });
  const targetPublication = publication({
    publicationId: execution.identifiers.candidatePublicationId,
    revision: execution.candidateRevision,
    previousActiveRevisionId: execution.identifiers.baselineRevisionId,
    snapshotRef: candidateRef,
    domain: candidateDomain,
  });
  return {
    execution,
    baselineSnapshot,
    candidateSnapshot,
    baselineDomain,
    candidateDomain,
    targetPublication,
    candidateRef,
  };
}

export function createDevPublicationCandidateRecovery(remote, runId) {
  const expected = createExpectedDevPublicationCandidateRecovery(runId);
  const {
    execution,
    baselineSnapshot,
    candidateSnapshot,
    baselineDomain,
    candidateDomain,
    targetPublication,
    candidateRef,
  } = expected;
  const expectedBaseline = createExpectedDevPublicationBaselineRecovery(runId);
  assertIdentity(remote, execution.identifiers);
  assertExactBaselinePublication(remote.baselinePublication, expectedBaseline.target.publication);
  assertCarrier(remote.snapshot, baselineSnapshot, candidateSnapshot, "Snapshot");
  assertPointer(remote.activeRevision, execution.identifiers);
  assertAbsent(remote.rollbackPublication, "rollback publication");

  if (remote.candidateRevision === null) {
    assertState(remote, baselineDomain, null, baselineSnapshot, execution.identifiers.baselineRevisionId, null);
    return stage("needs_candidate_seed", execution, candidateDomain, targetPublication, candidateRef, {
      write_candidate_revision: true,
    });
  }

  const candidateState = classify(remote.candidateRevision, execution.candidateRevision, candidateDomain.revisions.find(
    (revision) => revision.revision_id === execution.identifiers.candidateRevisionId,
  ), "candidate revision");
  const baselineRevisionState = classify(
    remote.baselineRevision,
    baselineDomain.revisions.find((revision) => revision.revision_id === execution.identifiers.baselineRevisionId),
    candidateDomain.revisions.find((revision) => revision.revision_id === execution.identifiers.baselineRevisionId),
    "baseline revision",
  );
  const definitionState = classify(
    remote.definition,
    baselineDomain.definition,
    candidateDomain.definition,
    "definition",
  );
  const snapshotState = classifySnapshot(remote.snapshot.document, baselineSnapshot, candidateSnapshot);
  const pointerState = classifyPointer(remote.activeRevision.document, execution.identifiers);
  const publicationState = classifyOptional(remote.candidatePublication, targetPublication, "candidate publication");

  if (candidateState === "initial" && baselineRevisionState === "initial" && definitionState === "initial"
      && snapshotState === "baseline" && pointerState === "baseline" && publicationState === "absent") {
    return stage("ready_to_publish", execution, candidateDomain, targetPublication, candidateRef, {});
  }
  if (snapshotState === "candidate" && publicationState === "absent") {
    if (pointerState === "baseline"
        && baselineRevisionState === "initial" && candidateState === "initial" && definitionState === "initial") {
      return stage("ready_to_complete_candidate", execution, candidateDomain, targetPublication, candidateRef, {
        write_active_pointer: true,
      });
    }
    if (pointerState === "candidate") {
      if (baselineRevisionState === "initial" && candidateState === "initial" && definitionState === "initial") {
        return stage("ready_to_complete_candidate", execution, candidateDomain, targetPublication, candidateRef, {
          write_baseline_revision: true,
        });
      }
      if (baselineRevisionState === "target" && candidateState === "initial" && definitionState === "initial") {
        return stage("ready_to_complete_candidate", execution, candidateDomain, targetPublication, candidateRef, {
          write_candidate_revision: true,
        });
      }
      if (baselineRevisionState === "target" && candidateState === "target" && definitionState === "initial") {
        return stage("ready_to_complete_candidate", execution, candidateDomain, targetPublication, candidateRef, {
          write_definition: true,
        });
      }
      if (baselineRevisionState === "target" && candidateState === "target" && definitionState === "target") {
        return stage("ready_to_complete_candidate", execution, candidateDomain, targetPublication, candidateRef, {
          write_publication: true,
        });
      }
    }
  }
  if (snapshotState === "candidate" && pointerState === "candidate"
      && baselineRevisionState === "target" && candidateState === "target" && definitionState === "target"
      && publicationState === "target") {
    return stage("candidate_recovered", execution, candidateDomain, targetPublication, candidateRef, {});
  }
  throw new DevPublicationCandidateRecoveryError("remote candidate state is not an approved resumable state");
}

function assertExactBaselinePublication(actual, expected) {
  if (!same(actual, expected)) {
    throw new DevPublicationCandidateRecoveryError(
      "exact baseline PublicationRecord is required; run npm run recover:shopify-publication-rehearsal:dev",
    );
  }
}

function stage(status, execution, domain, targetPublication, snapshotRef, steps) {
  return {
    status,
    identifiers: execution.identifiers,
    candidate_draft: execution.candidateRevision,
    candidate_snapshot_ref: snapshotRef,
    target: { domain, publication: targetPublication },
    steps,
  };
}

function publication({ publicationId, revision, previousActiveRevisionId, snapshotRef, domain }) {
  let attempt = createPublicationAttempt({
    publicationId,
    revision,
    runtimeSnapshotRef: snapshotRef,
    previousActiveRevisionId,
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
      previous_active_revision_id: previousActiveRevisionId,
      active_revision_id: revision.revision_id,
      snapshot_checksum: snapshotRef.checksum,
      warnings: ["recovered_partial_rehearsal"],
      domain,
      publication_attempt: attempt,
    },
    domain,
  };
}

function assertIdentity(remote, identifiers) {
  if (remote.definition?.bundle_definition_id !== identifiers.bundleDefinitionId ||
      remote.baselineRevision?.revision_id !== identifiers.baselineRevisionId ||
      remote.baselineRevision?.bundle_definition_id !== identifiers.bundleDefinitionId) {
    throw new DevPublicationCandidateRecoveryError("rehearsal domain identity does not match");
  }
}

function assertCarrier(carrier, baseline, candidate, label) {
  if (!carrier?.compareDigest || ![baseline.checksum, candidate.checksum].includes(carrier.document?.checksum)) {
    throw new DevPublicationCandidateRecoveryError(`isolated ${label} differs from both approved states`);
  }
}

function assertPointer(carrier, identifiers) {
  if (!carrier?.compareDigest || ![identifiers.baselineRevisionId, identifiers.candidateRevisionId].includes(carrier.document)) {
    throw new DevPublicationCandidateRecoveryError("isolated active pointer differs from both approved states");
  }
}

function assertAbsent(value, label) {
  if (value !== null) throw new DevPublicationCandidateRecoveryError(`${label} must be absent`);
}

function assertState(remote, baselineDomain, candidate, baselineSnapshot, baselineRevisionId, publication) {
  if (classifyDomain(remote, baselineDomain, null) !== "baseline" ||
      classifySnapshot(remote.snapshot.document, baselineSnapshot, null) !== "baseline" ||
      remote.activeRevision.document !== baselineRevisionId || remote.candidatePublication !== publication || candidate !== null) {
    throw new DevPublicationCandidateRecoveryError("candidate seed preconditions do not match baseline");
  }
}

function classifyDomain(remote, baseline, candidate) {
  const baselineRevision = baseline.revisions.find((revision) => revision.revision_id === remote.baselineRevision.revision_id);
  if (same(remote.definition, baseline.definition) && same(remote.baselineRevision, baselineRevision)) return "baseline";
  if (candidate) {
    const targetBaseline = candidate.revisions.find((revision) => revision.revision_id === remote.baselineRevision.revision_id);
    if (same(remote.definition, candidate.definition) && same(remote.baselineRevision, targetBaseline)) return "candidate";
  }
  throw new DevPublicationCandidateRecoveryError("definition or baseline revision differs from approved states");
}

function classify(actual, initial, target, label) {
  if (same(actual, initial)) return "initial";
  if (same(actual, target)) return "target";
  throw new DevPublicationCandidateRecoveryError(`${label} differs from approved states`);
}

function classifyOptional(actual, target, label) {
  if (actual === null) return "absent";
  if (same(actual, target)) return "target";
  throw new DevPublicationCandidateRecoveryError(`${label} differs from the approved audit`);
}

function classifySnapshot(actual, baseline, candidate) {
  if (actual?.checksum === baseline.checksum) return "baseline";
  if (candidate && actual?.checksum === candidate.checksum) return "candidate";
  throw new DevPublicationCandidateRecoveryError("isolated Snapshot differs from approved states");
}

function classifyPointer(actual, identifiers) {
  if (actual === identifiers.baselineRevisionId) return "baseline";
  if (actual === identifiers.candidateRevisionId) return "candidate";
  throw new DevPublicationCandidateRecoveryError("isolated active pointer differs from approved states");
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
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
