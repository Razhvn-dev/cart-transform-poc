import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import {
  createPublicationAttempt,
  publishRevision,
  transitionPublicationAttempt,
} from "../extensions/master-kit-expand/src/config/bundle-domain.lifecycle.js";

import {
  DEV_PUBLICATION_REHEARSAL_AT,
  createDevPublicationRehearsalExecution,
} from "./dev-shopify-publication-rehearsal.execution.js";

export class DevPublicationRehearsalRecoveryError extends Error {
  constructor(message) {
    super(message);
    this.name = "DevPublicationRehearsalRecoveryError";
  }
}

export function createExpectedDevPublicationBaselineRecovery(runId) {
  const execution = createDevPublicationRehearsalExecution(runId);
  const { identifiers, definition: initialDefinition, baselineRevision: initialRevision } = execution;
  const snapshot = compileRuntimeSnapshot(initialRevision.configuration);
  const snapshotRef = {
    schema_version: snapshot.snapshot_schema,
    checksum_algorithm: snapshot.checksum_algorithm,
    checksum: snapshot.checksum,
    configuration_version: snapshot.configuration_version,
  };
  const targetDomain = publishRevision({
    definition: initialDefinition,
    revisions: [initialRevision],
    revisionId: identifiers.baselineRevisionId,
    runtimeSnapshotRef: snapshotRef,
    updatedAt: DEV_PUBLICATION_REHEARSAL_AT,
  });
  const publicationAttempt = recordedAttempt({
    publicationId: identifiers.baselinePublicationId,
    revision: initialRevision,
    runtimeSnapshotRef: snapshotRef,
  });
  const result = {
    success: true,
    publication_id: identifiers.baselinePublicationId,
    completed_steps: [
      "recovery_preflight",
      "snapshot_already_verified",
      "active_pointer_already_verified",
      "domain_persisted",
      "publication_recorded",
    ],
    failed_step: null,
    compensation: { attempted: false, success: true, steps: [] },
    previous_active_revision_id: null,
    active_revision_id: identifiers.baselineRevisionId,
    snapshot_checksum: snapshotRef.checksum,
    warnings: ["recovered_partial_rehearsal"],
    domain: targetDomain,
    publication_attempt: publicationAttempt,
  };
  return {
    execution,
    identifiers,
    snapshot_ref: snapshotRef,
    target: {
      definition: targetDomain.definition,
      revision: targetDomain.revisions[0],
      publication: {
        publication_attempt: publicationAttempt,
        result,
        domain: targetDomain,
      },
    },
  };
}

// This recovery is deliberately monotonic. It never writes either isolated
// product metafield: both already have the intended baseline values. It only
// completes the matching Metaobject lifecycle and its audit record.
export function createDevPublicationRehearsalRecovery(remote, runId) {
  const expected = createExpectedDevPublicationBaselineRecovery(runId);
  const { execution, identifiers, snapshot_ref: snapshotRef, target } = expected;
  const { definition: initialDefinition, baselineRevision: initialRevision } = execution;

  assertRemoteIdentity(remote, identifiers);
  assertSnapshotAndPointer(remote, identifiers.baselineRevisionId, snapshotRef);
  assertAbsent(remote.candidateRevision, "candidate revision");
  assertAbsent(remote.candidatePublication, "candidate publication");
  assertAbsent(remote.rollbackPublication, "rollback publication");

  const targetRevision = target.revision;
  const targetDefinition = target.definition;
  const targetPublication = target.publication;

  const revisionStep = classify(remote.baselineRevision, initialRevision, targetRevision, "baseline revision");
  const definitionStep = classify(remote.definition, initialDefinition, targetDefinition, "definition");
  const publicationStep = classifyOptional(remote.baselinePublication, targetPublication, "baseline publication");

  if (definitionStep === "target" && revisionStep !== "target") {
    throw new DevPublicationRehearsalRecoveryError("definition is published while baseline revision is not published");
  }
  if (publicationStep === "target" && (definitionStep !== "target" || revisionStep !== "target")) {
    throw new DevPublicationRehearsalRecoveryError("publication audit exists before the matching domain lifecycle");
  }

  return {
    identifiers,
    snapshot_ref: snapshotRef,
    remote_compare_digests: {
      snapshot: remote.snapshot.compareDigest,
      active_revision: remote.activeRevision.compareDigest,
    },
    target,
    steps: nextStep({ revisionStep, definitionStep, publicationStep }),
    status: publicationStep === "target" ? "already_recovered" : "ready_to_recover",
  };
}

function nextStep({ revisionStep, definitionStep, publicationStep }) {
  if (revisionStep === "initial") return { write_revision: true };
  if (definitionStep === "initial") return { write_definition: true };
  if (publicationStep === "absent") return { write_publication: true };
  return {};
}

function recordedAttempt({ publicationId, revision, runtimeSnapshotRef }) {
  let attempt = createPublicationAttempt({
    publicationId,
    revision,
    runtimeSnapshotRef,
    previousActiveRevisionId: null,
    attemptNumber: 1,
    createdAt: DEV_PUBLICATION_REHEARSAL_AT,
  });
  for (const state of ["compiled", "snapshot_written", "snapshot_verified", "active_pointer_updated", "recorded"]) {
    attempt = transitionPublicationAttempt(attempt, state, DEV_PUBLICATION_REHEARSAL_AT);
  }
  return attempt;
}

function assertRemoteIdentity(remote, identifiers) {
  if (!remote || typeof remote !== "object") throw new DevPublicationRehearsalRecoveryError("remote reconciliation is required");
  if (remote.definition?.bundle_definition_id !== identifiers.bundleDefinitionId) {
    throw new DevPublicationRehearsalRecoveryError("unexpected rehearsal BundleDefinition identity");
  }
  if (remote.baselineRevision?.revision_id !== identifiers.baselineRevisionId ||
      remote.baselineRevision?.bundle_definition_id !== identifiers.bundleDefinitionId) {
    throw new DevPublicationRehearsalRecoveryError("unexpected rehearsal baseline revision identity");
  }
}

function assertSnapshotAndPointer(remote, baselineRevisionId, snapshotRef) {
  if (remote.snapshot?.document?.checksum !== snapshotRef.checksum ||
      remote.snapshot.document?.configuration_version !== snapshotRef.configuration_version ||
      !remote.snapshot.compareDigest) {
    throw new DevPublicationRehearsalRecoveryError("isolated Snapshot does not match the compiled baseline");
  }
  if (remote.activeRevision?.document !== baselineRevisionId ||
      !remote.activeRevision.compareDigest) {
    throw new DevPublicationRehearsalRecoveryError("isolated active pointer does not match the baseline revision");
  }
}

function assertAbsent(value, label) {
  if (value !== null) throw new DevPublicationRehearsalRecoveryError(`${label} must be absent before recovery`);
}

function classify(actual, initial, target, label) {
  if (same(actual, initial)) return "initial";
  if (same(actual, target)) return "target";
  throw new DevPublicationRehearsalRecoveryError(`${label} differs from both the approved partial and recovery state`);
}

function classifyOptional(actual, target, label) {
  if (actual === null) return "absent";
  if (same(actual, target)) return "target";
  throw new DevPublicationRehearsalRecoveryError(`${label} differs from the approved recovery audit`);
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
