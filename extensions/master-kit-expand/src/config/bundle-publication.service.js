import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { comparePreparedFunctionResults } from "./bundle-runtime.result-comparator.js";
import { assertRuntimeSnapshotMetafieldSize } from "./bundle-runtime.snapshot-size.js";
import { validateRuntimeSnapshot } from "./bundle-runtime.validator.js";
import {
  createPublicationAttempt,
  publishRevision,
  rollbackActiveRevision,
  transitionPublicationAttempt,
} from "./bundle-domain.lifecycle.js";
import { parseBundleRevision } from "./bundle-domain.parser.js";
import { assertValidBundleDomain } from "./bundle-domain.validator.js";

export class BundlePublicationError extends Error {
  constructor(step, message) {
    super(message);
    this.name = "BundlePublicationError";
    this.step = step;
  }
}

export function publishDraftRevision(input, dependencies) {
  const publicationId = input.publication_id;
  const completedSteps = [];
  const warnings = [];
  const previousActiveRevisionId = input.definition.active_revision_id;
  let failedStep = "normalize_validate";
  let snapshot = null;
  let publicationAttempt = null;
  let snapshotWriteAttempted = false;
  let pointerWriteAttempted = false;
  let previousSnapshot = null;
  let proposedDomain = null;

  const external = requirePublicationDependencies(dependencies);
  const existing = external.readPublicationRecord(publicationId);
  if (existing?.result?.success) {
    return {
      ...structuredClone(existing.result),
      warnings: uniqueWarnings([...existing.result.warnings, "idempotent_retry"]),
    };
  }

  try {
    assertNoBundleInstanceId(input.definition);
    assertNoBundleInstanceId(input.revisions);
    assertValidBundleDomain({ definitions: [input.definition], revisions: input.revisions });
    const draftRevision = parseBundleRevision(findRevision(input.revisions, input.revision_id));
    if (draftRevision.status !== "draft") {
      throw new BundlePublicationError("normalize_validate", "only a draft revision can be published");
    }
    completedSteps.push("normalized_validated");

    failedStep = "compile_snapshot";
    snapshot = external.compile(draftRevision.configuration);
    const snapshotRef = runtimeSnapshotReference(snapshot);
    completedSteps.push("snapshot_compiled");

    failedStep = "checksum_size_gates";
    const validationErrors = external.validateSnapshot(snapshot);
    if (validationErrors.length > 0) {
      throw new BundlePublicationError("checksum_size_gates", validationErrors.join("; "));
    }
    const size = external.sizeGuard({ jsonValue: snapshot });
    if (!size.ok) {
      throw new BundlePublicationError("checksum_size_gates", size.reason);
    }
    if (size.warning) warnings.push(size.warning);
    completedSteps.push("checksum_size_gates");

    failedStep = "promotion_parity_gates";
    const promotion = external.runPromotionGates({
      snapshot,
      revision: draftRevision,
      promotion: input.promotion,
    });
    if (!promotion.ok) {
      throw new BundlePublicationError("promotion_parity_gates", promotion.reason ?? "parity_mismatch");
    }
    warnings.push(...(promotion.warnings ?? []));
    completedSteps.push("promotion_parity_gates");

    previousSnapshot = external.readSnapshot({ definition: input.definition });
    if (previousSnapshot && external.validateSnapshot(previousSnapshot).length > 0) {
      throw new BundlePublicationError("previous_snapshot_validation", "previous snapshot is not recoverable");
    }
    completedSteps.push("previous_snapshot_read");

    publicationAttempt = createPublicationAttempt({
      publicationId,
      revision: draftRevision,
      runtimeSnapshotRef: snapshotRef,
      previousActiveRevisionId,
      attemptNumber: input.attempt_number ?? 1,
      createdAt: input.at,
    });
    publicationAttempt = transitionPublicationAttempt(publicationAttempt, "compiled", input.at);

    failedStep = "snapshot_write";
    snapshotWriteAttempted = true;
    external.writeSnapshot({
      definition: input.definition,
      revision: draftRevision,
      snapshot: structuredClone(snapshot),
      previousSnapshot: structuredClone(previousSnapshot),
      publicationId,
    });
    publicationAttempt = transitionPublicationAttempt(publicationAttempt, "snapshot_written", input.at);
    completedSteps.push("snapshot_written");

    failedStep = "readback_verification";
    const readBackSnapshot = external.readSnapshot({ definition: input.definition });
    verifyReadBackSnapshot(readBackSnapshot, snapshotRef, external.validateSnapshot);
    publicationAttempt = transitionPublicationAttempt(publicationAttempt, "snapshot_verified", input.at);
    completedSteps.push("readback_verified");

    proposedDomain = publishRevision({
      definition: input.definition,
      revisions: input.revisions,
      revisionId: draftRevision.revision_id,
      runtimeSnapshotRef: snapshotRef,
      updatedAt: input.at,
    });

    failedStep = "external_pointer_drift";
    const observedActiveRevisionId = external.readActiveRevisionId({ definition: input.definition });
    if (observedActiveRevisionId !== previousActiveRevisionId) {
      throw new BundlePublicationError(
        "external_pointer_drift",
        "external active revision pointer does not match the expected previous pointer",
      );
    }

    failedStep = "active_pointer_update";
    pointerWriteAttempted = true;
    external.writeActiveRevisionId({
      definition: input.definition,
      expectedActiveRevisionId: previousActiveRevisionId,
      activeRevisionId: draftRevision.revision_id,
      publicationId,
    });
    publicationAttempt = transitionPublicationAttempt(publicationAttempt, "active_pointer_updated", input.at);
    completedSteps.push("active_pointer_updated");
    if (previousActiveRevisionId !== null) completedSteps.push("previous_revision_superseded");

    failedStep = "audit_record";
    publicationAttempt = transitionPublicationAttempt(publicationAttempt, "recorded", input.at);
    const result = successResult({
      publicationId,
      completedSteps: [...completedSteps, "publication_recorded"],
      previousActiveRevisionId,
      activeRevisionId: draftRevision.revision_id,
      snapshot,
      warnings,
      domain: proposedDomain,
      publicationAttempt,
    });
    external.writePublicationRecord({
      publicationAttempt,
      result: structuredClone(result),
      domain: structuredClone(proposedDomain),
    });
    return result;
  } catch (error) {
    const resolvedFailedStep = error instanceof BundlePublicationError ? error.step : failedStep;
    const compensation = compensate({
      external,
      definition: input.definition,
      previousSnapshot,
      previousActiveRevisionId,
      attemptedActiveRevisionId: input.revision_id,
      snapshotWriteAttempted,
      pointerWriteAttempted,
      publicationId,
    });
    if (!compensation.success) warnings.push("compensation_failed");
    return failureResult({
      publicationId,
      completedSteps,
      failedStep: resolvedFailedStep,
      compensation,
      previousActiveRevisionId,
      snapshot,
      warnings,
      error,
    });
  }
}

export function runExistingPublicationPromotionGates({ promotion }) {
  if (!promotion?.hardcoded_result || !promotion?.candidate_result) {
    return { ok: false, reason: "promotion_context_required", warnings: [] };
  }
  const comparison = comparePreparedFunctionResults(
    promotion.hardcoded_result,
    promotion.candidate_result,
  );
  return comparison.match && comparison.differences.length === 0
    ? { ok: true, comparison, warnings: [] }
    : { ok: false, reason: "parity_mismatch", comparison, warnings: [] };
}

export function rollbackPublishedRevision(input, dependencies) {
  const publicationId = input.publication_id;
  const completedSteps = [];
  const warnings = [];
  const previousActiveRevisionId = input.definition.active_revision_id;
  let failedStep = "normalize_validate";
  let snapshotWriteAttempted = false;
  let pointerWriteAttempted = false;
  let previousSnapshot = null;
  const snapshot = structuredClone(input.target_snapshot);
  const external = requirePublicationDependencies(dependencies);
  const existing = external.readPublicationRecord(publicationId);
  if (existing?.result?.success) {
    return {
      ...structuredClone(existing.result),
      warnings: uniqueWarnings([...existing.result.warnings, "idempotent_retry"]),
    };
  }

  try {
    assertNoBundleInstanceId(input.definition);
    assertNoBundleInstanceId(input.revisions);
    assertValidBundleDomain({ definitions: [input.definition], revisions: input.revisions });
    const targetRevision = parseBundleRevision(findRevision(input.revisions, input.target_revision_id));
    if (targetRevision.status !== "superseded") {
      throw new BundlePublicationError("normalize_validate", "rollback target must be a superseded revision");
    }
    completedSteps.push("normalized_validated");

    failedStep = "checksum_size_gates";
    const validationErrors = external.validateSnapshot(snapshot);
    if (validationErrors.length > 0) {
      throw new BundlePublicationError("checksum_size_gates", validationErrors.join("; "));
    }
    const snapshotRef = runtimeSnapshotReference(snapshot);
    if (
      snapshotRef.checksum !== targetRevision.runtime_snapshot_ref?.checksum ||
      snapshotRef.configuration_version !== targetRevision.revision_number
    ) {
      throw new BundlePublicationError("checksum_size_gates", "rollback snapshot does not match target revision");
    }
    const size = external.sizeGuard({ jsonValue: snapshot });
    if (!size.ok) throw new BundlePublicationError("checksum_size_gates", size.reason);
    if (size.warning) warnings.push(size.warning);
    completedSteps.push("checksum_size_gates");

    failedStep = "promotion_parity_gates";
    const promotion = external.runPromotionGates({
      snapshot,
      revision: targetRevision,
      promotion: input.promotion,
    });
    if (!promotion.ok) {
      throw new BundlePublicationError("promotion_parity_gates", promotion.reason ?? "parity_mismatch");
    }
    warnings.push(...(promotion.warnings ?? []));
    completedSteps.push("promotion_parity_gates");

    previousSnapshot = external.readSnapshot({ definition: input.definition });
    if (previousSnapshot && external.validateSnapshot(previousSnapshot).length > 0) {
      throw new BundlePublicationError("previous_snapshot_validation", "previous snapshot is not recoverable");
    }
    completedSteps.push("previous_snapshot_read");

    let publicationAttempt = createPublicationAttempt({
      publicationId,
      revision: targetRevision,
      previousActiveRevisionId,
      attemptNumber: input.attempt_number ?? 1,
      createdAt: input.at,
    });
    publicationAttempt = transitionPublicationAttempt(publicationAttempt, "compiled", input.at);

    failedStep = "snapshot_write";
    snapshotWriteAttempted = true;
    external.writeSnapshot({
      definition: input.definition,
      revision: targetRevision,
      snapshot: structuredClone(snapshot),
      previousSnapshot: structuredClone(previousSnapshot),
      publicationId,
    });
    publicationAttempt = transitionPublicationAttempt(publicationAttempt, "snapshot_written", input.at);
    completedSteps.push("snapshot_written");

    failedStep = "readback_verification";
    verifyReadBackSnapshot(
      external.readSnapshot({ definition: input.definition }),
      snapshotRef,
      external.validateSnapshot,
    );
    publicationAttempt = transitionPublicationAttempt(publicationAttempt, "snapshot_verified", input.at);
    completedSteps.push("readback_verified");

    const proposedDomain = rollbackActiveRevision({
      definition: input.definition,
      revisions: input.revisions,
      targetRevisionId: targetRevision.revision_id,
      updatedAt: input.at,
    });
    failedStep = "external_pointer_drift";
    if (external.readActiveRevisionId({ definition: input.definition }) !== previousActiveRevisionId) {
      throw new BundlePublicationError("external_pointer_drift", "external active revision pointer does not match the expected previous pointer");
    }

    failedStep = "active_pointer_update";
    pointerWriteAttempted = true;
    external.writeActiveRevisionId({
      definition: input.definition,
      expectedActiveRevisionId: previousActiveRevisionId,
      activeRevisionId: targetRevision.revision_id,
      publicationId,
    });
    publicationAttempt = transitionPublicationAttempt(publicationAttempt, "active_pointer_updated", input.at);
    completedSteps.push("active_pointer_updated", "previous_revision_superseded");

    failedStep = "audit_record";
    publicationAttempt = transitionPublicationAttempt(publicationAttempt, "recorded", input.at);
    const result = successResult({
      publicationId,
      completedSteps: [...completedSteps, "publication_recorded"],
      previousActiveRevisionId,
      activeRevisionId: targetRevision.revision_id,
      snapshot,
      warnings,
      domain: proposedDomain,
      publicationAttempt,
    });
    external.writePublicationRecord({
      publicationAttempt,
      result: structuredClone(result),
      domain: structuredClone(proposedDomain),
    });
    return result;
  } catch (error) {
    const resolvedFailedStep = error instanceof BundlePublicationError ? error.step : failedStep;
    const compensation = compensate({
      external,
      definition: input.definition,
      previousSnapshot,
      previousActiveRevisionId,
      attemptedActiveRevisionId: input.target_revision_id,
      snapshotWriteAttempted,
      pointerWriteAttempted,
      publicationId,
    });
    if (!compensation.success) warnings.push("compensation_failed");
    return failureResult({
      publicationId,
      completedSteps,
      failedStep: resolvedFailedStep,
      compensation,
      previousActiveRevisionId,
      snapshot,
      warnings,
      error,
    });
  }
}

function requirePublicationDependencies(dependencies = {}) {
  return {
    compile: dependencies.compile ?? compileRuntimeSnapshot,
    validateSnapshot: dependencies.validateSnapshot ?? validateRuntimeSnapshot,
    sizeGuard: dependencies.sizeGuard ?? assertRuntimeSnapshotMetafieldSize,
    runPromotionGates: dependencies.runPromotionGates ?? runExistingPublicationPromotionGates,
    readPublicationRecord: dependencies.readPublicationRecord ?? (() => null),
    readSnapshot: requiredDependency(dependencies, "readSnapshot"),
    writeSnapshot: requiredDependency(dependencies, "writeSnapshot"),
    readActiveRevisionId: requiredDependency(dependencies, "readActiveRevisionId"),
    writeActiveRevisionId: requiredDependency(dependencies, "writeActiveRevisionId"),
    restoreSnapshot: requiredDependency(dependencies, "restoreSnapshot"),
    restoreActiveRevisionId: requiredDependency(dependencies, "restoreActiveRevisionId"),
    writePublicationRecord: requiredDependency(dependencies, "writePublicationRecord"),
  };
}

function requiredDependency(dependencies, name) {
  if (typeof dependencies[name] !== "function") {
    throw new BundlePublicationError("dependency_configuration", `missing injected dependency "${name}"`);
  }
  return dependencies[name];
}

function verifyReadBackSnapshot(snapshot, expected, validateSnapshot) {
  if (!snapshot || validateSnapshot(snapshot).length > 0) {
    throw new BundlePublicationError("readback_verification", "read-back snapshot is invalid");
  }
  if (
    snapshot.snapshot_schema !== expected.schema_version ||
    snapshot.configuration_version !== expected.configuration_version ||
    snapshot.checksum !== expected.checksum ||
    snapshot.checksum_algorithm !== expected.checksum_algorithm
  ) {
    throw new BundlePublicationError("readback_verification", "read-back snapshot does not match compiled snapshot");
  }
}

function runtimeSnapshotReference(snapshot) {
  return {
    schema_version: snapshot.snapshot_schema,
    checksum_algorithm: snapshot.checksum_algorithm,
    checksum: snapshot.checksum,
    configuration_version: snapshot.configuration_version,
  };
}

function compensate({
  external,
  definition,
  previousSnapshot,
  previousActiveRevisionId,
  attemptedActiveRevisionId,
  snapshotWriteAttempted,
  pointerWriteAttempted,
  publicationId,
}) {
  if (!snapshotWriteAttempted && !pointerWriteAttempted) {
    return { attempted: false, success: true, steps: [] };
  }

  const steps = [];
  const failures = [];
  if (pointerWriteAttempted) {
    try {
      external.restoreActiveRevisionId({
        definition,
        expectedActiveRevisionId: attemptedActiveRevisionId,
        activeRevisionId: previousActiveRevisionId,
        publicationId,
      });
      steps.push("active_pointer_restored");
    } catch (error) {
      failures.push({ step: "active_pointer_restore", message: error.message });
    }
  }
  if (snapshotWriteAttempted) {
    try {
      external.restoreSnapshot({
        definition,
        snapshot: structuredClone(previousSnapshot),
        publicationId,
      });
      steps.push("snapshot_restored");
    } catch (error) {
      failures.push({ step: "snapshot_restore", message: error.message });
    }
  }
  return {
    attempted: true,
    success: failures.length === 0,
    steps,
    failures,
  };
}

function successResult({
  publicationId,
  completedSteps,
  previousActiveRevisionId,
  activeRevisionId,
  snapshot,
  warnings,
  domain,
  publicationAttempt,
}) {
  return {
    success: true,
    publication_id: publicationId,
    completed_steps: completedSteps,
    failed_step: null,
    compensation: { attempted: false, success: true, steps: [] },
    previous_active_revision_id: previousActiveRevisionId,
    active_revision_id: activeRevisionId,
    snapshot_checksum: snapshot.checksum,
    warnings: uniqueWarnings(warnings),
    domain,
    publication_attempt: publicationAttempt,
  };
}

function failureResult({
  publicationId,
  completedSteps,
  failedStep,
  compensation,
  previousActiveRevisionId,
  snapshot,
  warnings,
  error,
}) {
  return {
    success: false,
    publication_id: publicationId,
    completed_steps: completedSteps,
    failed_step: failedStep,
    compensation,
    previous_active_revision_id: previousActiveRevisionId,
    active_revision_id: previousActiveRevisionId,
    snapshot_checksum: snapshot?.checksum ?? null,
    warnings: uniqueWarnings(warnings),
    error: error instanceof Error ? error.message : String(error),
  };
}

function findRevision(revisions, revisionId) {
  const revision = revisions.find((candidate) => candidate.revision_id === revisionId);
  if (!revision) throw new BundlePublicationError("normalize_validate", `revision "${revisionId}" was not found`);
  return revision;
}

function assertNoBundleInstanceId(value, path = "domain") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoBundleInstanceId(item, `${path}[${index}]`));
    return;
  }
  if (value == null || typeof value !== "object") return;
  Object.entries(value).forEach(([key, nestedValue]) => {
    if (key === "_bundle_id") {
      throw new BundlePublicationError("normalize_validate", `${path} must not persist _bundle_id`);
    }
    assertNoBundleInstanceId(nestedValue, `${path}.${key}`);
  });
}

function uniqueWarnings(warnings) {
  return [...new Set(warnings.filter(Boolean))];
}
