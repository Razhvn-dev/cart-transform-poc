import { BundlePersistenceError, normalizeBundlePersistenceError } from "./bundle-persistence.adapter.js";
import { compilePrebuiltBundleImportTarget } from "./prebuilt-bundle-import.target.js";

export const PREBUILT_BUNDLE_IMPORT_TARGET_PERSISTENCE_SCHEMA_VERSION =
  "prebuilt_bundle_import_target_persistence.v1";

export function createPrebuiltBundleImportTargetWriter({
  persistence,
  pilot_scope,
  id_factory,
  now = () => new Date().toISOString(),
  created_by = "prebuilt-import",
} = {}) {
  assertPersistence(persistence);
  if (typeof id_factory !== "function") {
    throw new BundlePersistenceError("UNSUPPORTED_CAPABILITY", "target writer requires an ID factory");
  }
  return async ({ import_id, source_identity, source_fingerprint, target_fingerprint, record }) => {
    const at = now();
    const compiled = compilePrebuiltBundleImportTarget({
      record,
      pilot_scope,
      revision_id: id_factory("revision"),
      created_at: at,
      created_by,
    });
    if (compiled.status !== "ready") {
      throw new BundlePersistenceError("WRITE_FAILED", `target compilation failed: ${compiled.reason}`);
    }
    return persistPrebuiltBundleImportTarget({
      compiled_target: compiled,
      import_id,
      publication_id: id_factory("publication"),
      source_identity,
      source_fingerprint,
      target_fingerprint,
      at,
    }, { persistence });
  };
}

/**
 * Persists a compiled target in a resumable order. It never deletes partially
 * created Shopify resources; an exact retry resumes, while drift fails closed.
 */
export async function persistPrebuiltBundleImportTarget({
  compiled_target: compiled,
  import_id,
  publication_id,
  source_identity,
  source_fingerprint,
  target_fingerprint,
  at,
} = {}, { persistence } = {}) {
  assertInput({ compiled, import_id, publication_id, source_identity, source_fingerprint, target_fingerprint, at });
  assertPersistence(persistence);
  const definitionId = compiled.definition.bundle_definition_id;
  const revisionId = compiled.revision.revision_id;
  const completedSteps = [];

  try {
    const existingRecord = await persistence.readPublicationById(publication_id);
    if (existingRecord !== null) {
      if (existingRecord.schema_version === PREBUILT_BUNDLE_IMPORT_TARGET_PERSISTENCE_SCHEMA_VERSION
        && existingRecord.target_fingerprint === target_fingerprint
        && existingRecord.result?.success === true) {
        return Object.freeze({ ...existingRecord.result, idempotent_retry: true });
      }
      throw new BundlePersistenceError("RETRY_CONFLICT", "publication_id already belongs to different content");
    }

    const stagedDefinition = { ...compiled.definition, active_revision_id: null };
    const existingDefinition = await readOptional(() => persistence.readBundleDefinition(definitionId));
    assertExactOrMissing(existingDefinition, [stagedDefinition, compiled.definition], "BundleDefinition");
    if (existingDefinition === null) await persistence.writeBundleDefinition({ definition: stagedDefinition });
    completedSteps.push("definition_staged");

    const existingRevision = await readOptional(() => persistence.readRevision(revisionId));
    assertExactOrMissing(existingRevision, [compiled.revision], "BundleRevision");
    if (existingRevision === null) await persistence.writeRevision({ revision: compiled.revision });
    completedSteps.push("revision_written");

    const existingSnapshot = await persistence.readRuntimeSnapshot(definitionId);
    assertExactOrMissing(existingSnapshot, [compiled.snapshot], "Runtime Snapshot");
    if (existingSnapshot === null) {
      await persistence.writeRuntimeSnapshot({
        bundle_definition_id: definitionId,
        expected_previous_snapshot_checksum: null,
        target_revision_id: revisionId,
        target_snapshot_checksum: compiled.snapshot.checksum,
        publication_id,
        snapshot: compiled.snapshot,
      });
    }
    completedSteps.push("snapshot_written");

    const existingProjection = await persistence.readPrebuiltExpandProjection(definitionId);
    assertExactOrMissing(existingProjection, [compiled.expand_projection], "expand projection");
    if (existingProjection === null) {
      await persistence.writePrebuiltExpandProjection({
        bundle_definition_id: definitionId,
        expected_previous_projection_checksum: null,
        target_revision_id: revisionId,
        target_projection_checksum: compiled.expand_projection.checksum,
        publication_id,
        projection: compiled.expand_projection,
      });
    }
    completedSteps.push("projection_written");

    const activeRevisionId = await persistence.readActiveRevisionId(definitionId);
    if (activeRevisionId !== null && activeRevisionId !== revisionId) {
      throw new BundlePersistenceError("POINTER_DRIFT", "active revision pointer belongs to different content");
    }
    if (activeRevisionId === null) {
      await persistence.compareAndSetActiveRevision({
        bundle_definition_id: definitionId,
        expected_active_revision_id: null,
        target_revision_id: revisionId,
        publication_id,
      });
    }
    completedSteps.push("active_pointer_updated");

    const currentDefinition = await persistence.readBundleDefinition(definitionId);
    assertExactOrMissing(currentDefinition, [stagedDefinition, compiled.definition], "BundleDefinition");
    if (!sameValue(currentDefinition, compiled.definition)) {
      await persistence.writeBundleDefinition({ definition: compiled.definition });
    }
    completedSteps.push("definition_activated");

    const result = Object.freeze({
      success: true,
      import_id,
      publication_id,
      source_identity,
      bundle_definition_id: definitionId,
      revision_id: revisionId,
      snapshot_checksum: compiled.snapshot.checksum,
      projection_checksum: compiled.expand_projection.checksum,
      completed_steps: Object.freeze([...completedSteps, "audit_recorded"]),
      recovery_required: false,
    });
    await persistence.writePublicationRecord({
      publication_id,
      record: {
        schema_version: PREBUILT_BUNDLE_IMPORT_TARGET_PERSISTENCE_SCHEMA_VERSION,
        import_id,
        publication_id,
        source_identity,
        source_fingerprint,
        target_fingerprint,
        created_at: at,
        result,
      },
    });
    return result;
  } catch (error) {
    const normalized = normalizeBundlePersistenceError(error);
    throw new BundlePersistenceError(normalized.code, normalized.message, {
      ...(normalized.details ?? {}),
      completed_steps: completedSteps,
      recovery_required: completedSteps.length > 0,
      recovery_strategy: completedSteps.length > 0 ? "EXACT_RETRY_OR_MANUAL_RECONCILIATION" : null,
    });
  }
}

async function readOptional(read) {
  try {
    return await read();
  } catch (error) {
    if (error?.code === "NOT_FOUND") return null;
    throw error;
  }
}

function assertExactOrMissing(existing, allowed, label) {
  if (existing !== null && !allowed.some((candidate) => sameValue(existing, candidate))) {
    throw new BundlePersistenceError("RETRY_CONFLICT", `${label} already contains different content`);
  }
}

function assertInput({ compiled, import_id, publication_id, source_identity, source_fingerprint, target_fingerprint, at }) {
  if (compiled?.status !== "ready") throw new BundlePersistenceError("WRITE_FAILED", "compiled target must be ready");
  for (const [field, value] of Object.entries({ import_id, publication_id, source_identity, source_fingerprint, target_fingerprint, at })) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new BundlePersistenceError("WRITE_FAILED", `${field} must be a non-empty string`);
    }
  }
  if (compiled.assignment?.target_fingerprint !== target_fingerprint) {
    throw new BundlePersistenceError("WRITE_FAILED", "compiled target fingerprint does not match execution input");
  }
}

function assertPersistence(persistence) {
  const required = [
    "readBundleDefinition", "writeBundleDefinition", "readRevision", "writeRevision",
    "readRuntimeSnapshot", "writeRuntimeSnapshot", "readPrebuiltExpandProjection",
    "writePrebuiltExpandProjection", "readActiveRevisionId", "compareAndSetActiveRevision",
    "readPublicationById", "writePublicationRecord",
  ];
  const missing = required.filter((method) => typeof persistence?.[method] !== "function");
  if (missing.length > 0) throw new BundlePersistenceError("UNSUPPORTED_CAPABILITY", `target persistence is missing: ${missing.join(", ")}`);
}

function sameValue(left, right) {
  return stableJson(left) === stableJson(right);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
