import {
  BundlePersistenceError,
  assertBundlePersistenceAdapter,
} from "./bundle-persistence.adapter.js";

// Bridges the normalized persistence contract to the staged publication
// orchestrator. It is intentionally not exposed by an HTTP route or UI.
export function createBundlePublicationPersistenceDriver({ persistence }) {
  assertBundlePersistenceAdapter(persistence);
  if (typeof persistence.readActiveRevisionId !== "function") {
    throw new BundlePersistenceError(
      "UNSUPPORTED_CAPABILITY",
      "publication persistence requires readActiveRevisionId for external pointer drift checks",
    );
  }

  return {
    readPublicationRecord: (publicationId) => persistence.readPublicationById(publicationId),
    readSnapshot: ({ definition }) => persistence.readRuntimeSnapshot(definition.bundle_definition_id),
    writeSnapshot: ({ definition, revision, snapshot, previousSnapshot, publicationId }) => (
      persistence.writeRuntimeSnapshot({
        bundle_definition_id: definition.bundle_definition_id,
        expected_previous_snapshot_checksum: previousSnapshot?.checksum ?? null,
        target_revision_id: revision.revision_id,
        target_snapshot_checksum: snapshot.checksum,
        publication_id: publicationId,
        snapshot,
      })
    ),
    restoreSnapshot: ({ definition, snapshot, targetSnapshot, targetRevisionId, publicationId }) => (
      persistence.restorePreviousSnapshot({
        bundle_definition_id: definition.bundle_definition_id,
        expected_previous_snapshot_checksum: snapshot?.checksum ?? null,
        target_revision_id: targetRevisionId,
        target_snapshot_checksum: targetSnapshot?.checksum,
        publication_id: publicationId,
        previous_snapshot: snapshot,
      })
    ),
    readActiveRevisionId: ({ definition }) => persistence.readActiveRevisionId(definition.bundle_definition_id),
    writeActiveRevisionId: ({ definition, expectedActiveRevisionId, activeRevisionId, publicationId }) => (
      persistence.compareAndSetActiveRevision({
        bundle_definition_id: definition.bundle_definition_id,
        expected_active_revision_id: expectedActiveRevisionId,
        target_revision_id: activeRevisionId,
        publication_id: publicationId,
      })
    ),
    restoreActiveRevisionId: ({ definition, expectedActiveRevisionId, activeRevisionId, publicationId }) => (
      persistence.compareAndSetActiveRevision({
        bundle_definition_id: definition.bundle_definition_id,
        expected_active_revision_id: expectedActiveRevisionId,
        target_revision_id: activeRevisionId,
        publication_id: publicationId,
      })
    ),
    persistDomain: ({ previousDomain, domain }) => writeChangedDomain(persistence, previousDomain, domain),
    restoreDomain: ({ previousDomain, domain }) => writeChangedDomain(persistence, domain, previousDomain),
    writePublicationRecord: ({ publicationAttempt, result, domain }) => (
      persistence.writePublicationRecord({
        publication_id: publicationAttempt.publication_id,
        record: { publication_attempt: publicationAttempt, result, domain },
      })
    ),
  };
}

async function writeChangedDomain(persistence, previousDomain, nextDomain) {
  const previousById = new Map(previousDomain.revisions.map((revision) => [revision.revision_id, revision]));
  for (const revision of nextDomain.revisions) {
    if (stableJson(previousById.get(revision.revision_id)) !== stableJson(revision)) {
      await persistence.writeRevision({ revision });
    }
  }
  if (stableJson(previousDomain.definition) !== stableJson(nextDomain.definition)) {
    await persistence.writeBundleDefinition({ definition: nextDomain.definition });
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
