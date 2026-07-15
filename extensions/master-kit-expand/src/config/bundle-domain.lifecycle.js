import {
  BUNDLE_PUBLICATION_ATTEMPT_SCHEMA_VERSION,
  PUBLICATION_ATTEMPT_TRANSITIONS,
  REVISION_TRANSITIONS,
} from "./bundle-domain.schema.js";
import {
  assertValidBundleDomain,
  assertValidBundleRevision,
  assertValidPublicationAttempt,
} from "./bundle-domain.validator.js";
import {
  parseBundleDefinition,
  parseBundleRevision,
  parsePublicationAttempt,
} from "./bundle-domain.parser.js";

export class BundleDomainTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "BundleDomainTransitionError";
  }
}

export function updateDraftRevision(revision, changes) {
  assertValidBundleRevision(revision);
  if (revision.status !== "draft") {
    throw new BundleDomainTransitionError("only draft revisions are editable");
  }

  const updated = {
    ...structuredClone(revision),
    ...structuredClone(changes),
    revision_id: revision.revision_id,
    bundle_definition_id: revision.bundle_definition_id,
    revision_number: revision.revision_number,
    status: "draft",
    runtime_snapshot_ref: null,
  };
  return parseBundleRevision(updated);
}

export function createNextDraftRevision({ publishedRevision, revisionId, createdAt, createdBy }) {
  assertValidBundleRevision(publishedRevision);
  if (publishedRevision.status !== "published") {
    throw new BundleDomainTransitionError("a new draft must be created from a published revision");
  }

  const revisionNumber = publishedRevision.revision_number + 1;
  const configuration = structuredClone(publishedRevision.configuration);
  configuration.configuration_version = revisionNumber;
  configuration.status = "draft";
  configuration.revision = {
    ...configuration.revision,
    draft_revision: revisionNumber,
  };

  return parseBundleRevision({
    ...structuredClone(publishedRevision),
    revision_id: revisionId,
    revision_number: revisionNumber,
    status: "draft",
    configuration,
    runtime_snapshot_ref: null,
    created_at: createdAt,
    updated_at: createdAt,
    created_by: createdBy,
  });
}

export function transitionRevision(revision, nextStatus, updatedAt) {
  assertValidBundleRevision(revision);
  const allowed = REVISION_TRANSITIONS.get(revision.status) ?? new Set();
  if (!allowed.has(nextStatus)) {
    throw new BundleDomainTransitionError(`revision transition ${revision.status} -> ${nextStatus} is not allowed`);
  }
  return parseBundleRevision({
    ...structuredClone(revision),
    status: nextStatus,
    updated_at: updatedAt,
  });
}

export function publishRevision({ definition, revisions, revisionId, runtimeSnapshotRef, updatedAt }) {
  assertValidBundleDomain({ definitions: [definition], revisions });
  const candidate = getRevision(revisions, revisionId);
  if (candidate.bundle_definition_id !== definition.bundle_definition_id || candidate.status !== "draft") {
    throw new BundleDomainTransitionError("only a draft revision for this definition can be published");
  }
  assertRevisionIsNext(revisions, candidate);

  const publishedCandidate = parseBundleRevision({
    ...structuredClone(candidate),
    status: "published",
    runtime_snapshot_ref: structuredClone(runtimeSnapshotRef),
    updated_at: updatedAt,
  });
  const nextRevisions = revisions.map((revision) => {
    if (revision.revision_id === candidate.revision_id) return publishedCandidate;
    if (revision.revision_id === definition.active_revision_id) {
      return transitionRevision(revision, "superseded", updatedAt);
    }
    return revision;
  });
  const nextDefinition = parseBundleDefinition({
    ...structuredClone(definition),
    active_revision_id: candidate.revision_id,
    updated_at: updatedAt,
  });
  assertValidBundleDomain({ definitions: [nextDefinition], revisions: nextRevisions });
  return { definition: nextDefinition, revisions: nextRevisions };
}

export function rollbackActiveRevision({ definition, revisions, targetRevisionId, updatedAt }) {
  assertValidBundleDomain({ definitions: [definition], revisions });
  const target = getRevision(revisions, targetRevisionId);
  const active = getRevision(revisions, definition.active_revision_id);
  if (target.bundle_definition_id !== definition.bundle_definition_id || target.status !== "superseded") {
    throw new BundleDomainTransitionError("rollback target must be a superseded revision for this definition");
  }
  if (active.status !== "published") {
    throw new BundleDomainTransitionError("active revision must be published before rollback");
  }

  const nextRevisions = revisions.map((revision) => {
    if (revision.revision_id === target.revision_id) return transitionRevision(revision, "published", updatedAt);
    if (revision.revision_id === active.revision_id) return transitionRevision(revision, "superseded", updatedAt);
    return revision;
  });
  const nextDefinition = parseBundleDefinition({
    ...structuredClone(definition),
    active_revision_id: target.revision_id,
    updated_at: updatedAt,
  });
  assertValidBundleDomain({ definitions: [nextDefinition], revisions: nextRevisions });
  return { definition: nextDefinition, revisions: nextRevisions };
}

export function createPublicationRetryIdentity({ bundleDefinitionId, revisionId, checksum }) {
  return `${bundleDefinitionId}:${revisionId}:${checksum}`;
}

export function transitionPublicationAttempt(attempt, nextState, updatedAt) {
  assertValidPublicationAttempt(attempt);
  const allowed = PUBLICATION_ATTEMPT_TRANSITIONS.get(attempt.state) ?? new Set();
  if (!allowed.has(nextState)) {
    throw new BundleDomainTransitionError(`publication attempt transition ${attempt.state} -> ${nextState} is not allowed`);
  }
  return parsePublicationAttempt({
    ...structuredClone(attempt),
    state: nextState,
    updated_at: updatedAt,
  });
}

export function createPublicationAttempt({
  publicationId,
  revision,
  runtimeSnapshotRef = revision.runtime_snapshot_ref,
  previousActiveRevisionId,
  attemptNumber,
  createdAt,
}) {
  assertValidBundleRevision(revision);
  if (runtimeSnapshotRef === null || runtimeSnapshotRef === undefined) {
    throw new BundleDomainTransitionError("publication attempt requires a runtime snapshot reference");
  }
  const snapshotReference = structuredClone(runtimeSnapshotRef);
  return parsePublicationAttempt({
    schema_version: BUNDLE_PUBLICATION_ATTEMPT_SCHEMA_VERSION,
    publication_id: publicationId,
    bundle_definition_id: revision.bundle_definition_id,
    revision_id: revision.revision_id,
    revision_number: revision.revision_number,
    retry_identity: createPublicationRetryIdentity({
      bundleDefinitionId: revision.bundle_definition_id,
      revisionId: revision.revision_id,
      checksum: snapshotReference.checksum,
    }),
    attempt_number: attemptNumber,
    state: "pending",
    runtime_snapshot_ref: snapshotReference,
    previous_active_revision_id: previousActiveRevisionId,
    created_at: createdAt,
    updated_at: createdAt,
  });
}

function getRevision(revisions, revisionId) {
  const revision = revisions.find((candidate) => candidate.revision_id === revisionId);
  if (!revision) throw new BundleDomainTransitionError(`revision "${revisionId}" was not found`);
  return revision;
}

function assertRevisionIsNext(revisions, candidate) {
  const maximumPriorRevision = revisions
    .filter((revision) => revision.bundle_definition_id === candidate.bundle_definition_id)
    .filter((revision) => revision.revision_id !== candidate.revision_id)
    .reduce((maximum, revision) => Math.max(maximum, revision.revision_number), 0);
  if (candidate.revision_number <= maximumPriorRevision) {
    throw new BundleDomainTransitionError("published revision_number must be greater than every prior revision_number");
  }
}
