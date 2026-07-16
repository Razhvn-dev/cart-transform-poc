import {
  BundlePersistenceError,
  assertActiveRevisionCasInput,
  assertBundlePersistenceAdapter,
  assertSnapshotCasInput,
  normalizeBundlePersistenceError,
} from "./bundle-persistence.adapter.js";

export function createInMemoryBundlePersistenceAdapter({
  definitions = [],
  revisions = [],
  snapshots = {},
  publications = {},
  capabilities = {},
  failures = {},
} = {}) {
  const definitionStore = new Map(definitions.map((item) => [item.bundle_definition_id, clone(item)]));
  const revisionStore = new Map(revisions.map((item) => [item.revision_id, clone(item)]));
  const snapshotStore = new Map(Object.entries(clone(snapshots)));
  const publicationStore = new Map(Object.entries(clone(publications)));
  const supported = { active_revision_cas: true, snapshot_checksum_cas: true, ...capabilities };
  const calls = [];

  const adapter = {
    capabilities: supported,
    readBundleDefinition(bundleDefinitionId) {
      calls.push("readBundleDefinition");
      return required(definitionStore, bundleDefinitionId, "BundleDefinition");
    },
    writeBundleDefinition({ definition }) {
      calls.push("writeBundleDefinition");
      failIfConfigured(failures, "writeBundleDefinition", "WRITE_FAILED");
      definitionStore.set(definition.bundle_definition_id, clone(definition));
      return clone(definition);
    },
    readRevision(revisionId) {
      calls.push("readRevision");
      return required(revisionStore, revisionId, "BundleRevision");
    },
    writeRevision({ revision }) {
      calls.push("writeRevision");
      failIfConfigured(failures, "writeRevision", "WRITE_FAILED");
      revisionStore.set(revision.revision_id, clone(revision));
      return clone(revision);
    },
    readRuntimeSnapshot(bundleDefinitionId) {
      calls.push("readRuntimeSnapshot");
      return clone(snapshotStore.get(bundleDefinitionId) ?? null);
    },
    readActiveRevisionId(bundleDefinitionId) {
      calls.push("readActiveRevisionId");
      return required(definitionStore, bundleDefinitionId, "BundleDefinition").active_revision_id;
    },
    writeRuntimeSnapshot(input) {
      calls.push("writeRuntimeSnapshot");
      assertSnapshotCasInput(input);
      requireCapability(supported, "snapshot_checksum_cas");
      failIfConfigured(failures, "writeRuntimeSnapshot", "WRITE_FAILED");
      const current = snapshotStore.get(input.bundle_definition_id) ?? null;
      const currentChecksum = current?.checksum ?? null;
      if (currentChecksum !== input.expected_previous_snapshot_checksum) {
        throw new BundlePersistenceError("CHECKSUM_MISMATCH", "previous Snapshot checksum does not match");
      }
      if (input.snapshot?.checksum !== input.target_snapshot_checksum) {
        throw new BundlePersistenceError("CHECKSUM_MISMATCH", "target Snapshot checksum does not match");
      }
      snapshotStore.set(input.bundle_definition_id, clone(input.snapshot));
      return clone(input.snapshot);
    },
    compareAndSetActiveRevision(input) {
      calls.push("compareAndSetActiveRevision");
      assertActiveRevisionCasInput(input);
      requireCapability(supported, "active_revision_cas");
      failIfConfigured(failures, "compareAndSetActiveRevision", "WRITE_FAILED");
      const definition = required(definitionStore, input.bundle_definition_id, "BundleDefinition");
      if (definition.active_revision_id !== input.expected_active_revision_id) {
        throw new BundlePersistenceError("POINTER_DRIFT", "active_revision_id does not match expected value");
      }
      const updated = { ...definition, active_revision_id: input.target_revision_id };
      definitionStore.set(input.bundle_definition_id, updated);
      return clone(updated);
    },
    writePublicationRecord({ publication_id, record }) {
      calls.push("writePublicationRecord");
      failIfConfigured(failures, "writePublicationRecord", "AUDIT_FAILED");
      const existing = publicationStore.get(publication_id);
      if (existing) {
        if (JSON.stringify(existing) === JSON.stringify(record)) return clone(existing);
        throw new BundlePersistenceError("RETRY_CONFLICT", "publication_id already has different content");
      }
      publicationStore.set(publication_id, clone(record));
      return clone(record);
    },
    readPublicationById(publicationId) {
      calls.push("readPublicationById");
      return clone(publicationStore.get(publicationId) ?? null);
    },
    listPublicationRecordsByDefinition(bundleDefinitionId) {
      calls.push("listPublicationRecordsByDefinition");
      return Array.from(publicationStore.values())
        .filter((record) => record?.publication_attempt?.bundle_definition_id === bundleDefinitionId)
        .map(clone);
    },
    restorePreviousSnapshot(input) {
      calls.push("restorePreviousSnapshot");
      assertSnapshotCasInput(input);
      requireCapability(supported, "snapshot_checksum_cas");
      failIfConfigured(failures, "restorePreviousSnapshot", "READ_BACK_FAILED");
      const current = snapshotStore.get(input.bundle_definition_id) ?? null;
      if (current?.checksum !== input.target_snapshot_checksum) {
        throw new BundlePersistenceError("CHECKSUM_MISMATCH", "target Snapshot checksum does not match persisted value");
      }
      if (input.previous_snapshot === null) snapshotStore.delete(input.bundle_definition_id);
      else snapshotStore.set(input.bundle_definition_id, clone(input.previous_snapshot));
      return clone(input.previous_snapshot);
    },
    state: { definitionStore, revisionStore, snapshotStore, publicationStore, calls },
  };
  return assertBundlePersistenceAdapter(adapter);
}

export function invokeAdapter(adapter, operation, input, fallbackCode) {
  try {
    return adapter[operation](input);
  } catch (error) {
    throw normalizeBundlePersistenceError(error, fallbackCode);
  }
}

function required(store, id, label) {
  const value = store.get(id);
  if (!value) throw new BundlePersistenceError("NOT_FOUND", `${label} was not found`);
  return clone(value);
}

function requireCapability(capabilities, capability) {
  if (!capabilities[capability]) {
    throw new BundlePersistenceError("UNSUPPORTED_CAPABILITY", `${capability} is not supported`);
  }
}

function failIfConfigured(failures, operation, code) {
  const failure = failures[operation];
  if (!failure) return;
  throw normalizeBundlePersistenceError(failure, code);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}
