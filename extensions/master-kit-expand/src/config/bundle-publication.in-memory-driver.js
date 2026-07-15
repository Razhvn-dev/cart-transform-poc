export function createInMemoryPublicationDriver({ snapshots = {}, activeRevisionIds = {}, records = {} } = {}) {
  const snapshotStore = new Map(Object.entries(structuredClone(snapshots)));
  const pointerStore = new Map(Object.entries(structuredClone(activeRevisionIds)));
  const recordStore = new Map(Object.entries(structuredClone(records)));
  const calls = [];

  const dependencies = {
    readPublicationRecord(publicationId) {
      calls.push("read_publication_record");
      return clone(recordStore.get(publicationId) ?? null);
    },
    readSnapshot({ definition }) {
      calls.push("read_snapshot");
      return clone(snapshotStore.get(definition.bundle_definition_id) ?? null);
    },
    writeSnapshot({ definition, snapshot }) {
      calls.push("write_snapshot");
      snapshotStore.set(definition.bundle_definition_id, clone(snapshot));
    },
    restoreSnapshot({ definition, snapshot }) {
      calls.push("restore_snapshot");
      if (snapshot === null) snapshotStore.delete(definition.bundle_definition_id);
      else snapshotStore.set(definition.bundle_definition_id, clone(snapshot));
    },
    readActiveRevisionId({ definition }) {
      calls.push("read_active_revision_id");
      return pointerStore.get(definition.bundle_definition_id) ?? null;
    },
    writeActiveRevisionId({ definition, expectedActiveRevisionId, activeRevisionId }) {
      calls.push("write_active_revision_id");
      const current = pointerStore.get(definition.bundle_definition_id) ?? null;
      if (current !== expectedActiveRevisionId) throw new Error("active revision pointer compare-and-set failed");
      pointerStore.set(definition.bundle_definition_id, activeRevisionId);
    },
    restoreActiveRevisionId({ definition, expectedActiveRevisionId, activeRevisionId }) {
      calls.push("restore_active_revision_id");
      const current = pointerStore.get(definition.bundle_definition_id) ?? null;
      if (current !== expectedActiveRevisionId) throw new Error("active revision pointer restore compare-and-set failed");
      if (activeRevisionId === null) pointerStore.delete(definition.bundle_definition_id);
      else pointerStore.set(definition.bundle_definition_id, activeRevisionId);
    },
    writePublicationRecord({ publicationAttempt, result, domain }) {
      calls.push("write_publication_record");
      recordStore.set(publicationAttempt.publication_id, clone({ publicationAttempt, result, domain }));
    },
  };

  return {
    dependencies,
    state: {
      calls,
      snapshots: snapshotStore,
      activeRevisionIds: pointerStore,
      records: recordStore,
    },
  };
}

function clone(value) {
  return value === null ? null : structuredClone(value);
}
