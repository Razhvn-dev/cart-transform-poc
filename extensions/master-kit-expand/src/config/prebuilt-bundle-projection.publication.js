import { BundlePersistenceError, normalizeBundlePersistenceError } from "./bundle-persistence.adapter.js";
import { validatePrebuiltBundleExpandProjection } from "./prebuilt-bundle-expand-projection.js";
import { derivePrebuiltBundleRuntimeMapping } from "./prebuilt-bundle-runtime.mapping.js";

export const PREBUILT_BUNDLE_PROJECTION_PUBLICATION_SCHEMA_VERSION =
  "prebuilt_bundle_projection_publication.v1";

/**
 * Publishes one already-approved fixed selection to its compact Checkout
 * projection carrier. This is local orchestration only; no route invokes it.
 */
export async function publishPrebuiltBundleExpandProjection(input, dependencies) {
  assertInput(input);
  const persistence = assertDependencies(dependencies);
  const existing = await persistence.readPublicationById(input.publication_id);
  if (isMatchingCompletedRecord(existing, input)) {
    return deepFreeze({ ...existing.result, idempotent_retry: true });
  }
  if (existing !== null) {
    throw new BundlePersistenceError("RETRY_CONFLICT", "publication_id already has different projection content");
  }

  const prepared = derivePrebuiltBundleRuntimeMapping({
    definition: input.definition,
    revision: input.revision,
    snapshot: input.snapshot,
    fixed_selections: input.fixed_selections,
    pilot_scope: input.pilot_scope,
  });
  if (prepared.status !== "ready") {
    throw new BundlePersistenceError("WRITE_FAILED", `projection preparation failed: ${prepared.reason}`);
  }

  const projection = prepared.expand_projection;
  const previousProjection = await persistence.readPrebuiltExpandProjection(
    input.definition.bundle_definition_id,
  );
  if (previousProjection !== null && validatePrebuiltBundleExpandProjection(previousProjection).length > 0) {
    throw new BundlePersistenceError("READ_BACK_FAILED", "previous projection is not recoverable");
  }

  let projectionWritten = false;
  try {
    await persistence.writePrebuiltExpandProjection({
      bundle_definition_id: input.definition.bundle_definition_id,
      expected_previous_projection_checksum: previousProjection?.checksum ?? null,
      target_revision_id: input.revision.revision_id,
      target_projection_checksum: projection.checksum,
      publication_id: input.publication_id,
      projection,
    });
    projectionWritten = true;

    const readBack = await persistence.readPrebuiltExpandProjection(
      input.definition.bundle_definition_id,
    );
    if (readBack?.checksum !== projection.checksum
      || validatePrebuiltBundleExpandProjection(readBack).length > 0) {
      throw new BundlePersistenceError("READ_BACK_FAILED", "projection read-back verification failed");
    }

    const result = deepFreeze({
      success: true,
      publication_id: input.publication_id,
      bundle_definition_id: input.definition.bundle_definition_id,
      revision_id: input.revision.revision_id,
      projection_checksum: projection.checksum,
      previous_projection_checksum: previousProjection?.checksum ?? null,
      compensation_required: false,
    });
    await persistence.writePublicationRecord({
      publication_id: input.publication_id,
      record: publicationRecord(input, projection, result),
    });
    return result;
  } catch (error) {
    const compensation = projectionWritten
      ? await compensateProjection({ persistence, input, projection, previousProjection })
      : { attempted: false, success: true, reason: null };
    const normalized = normalizeBundlePersistenceError(error);
    throw new BundlePersistenceError(normalized.code, normalized.message, {
      ...(normalized.details ?? {}),
      compensation,
    });
  }
}

async function compensateProjection({ persistence, input, projection, previousProjection }) {
  if (previousProjection === null) {
    return {
      attempted: false,
      success: false,
      reason: "INITIAL_PROJECTION_DELETE_WITH_CAS_UNSUPPORTED",
    };
  }
  try {
    await persistence.restorePreviousPrebuiltExpandProjection({
      bundle_definition_id: input.definition.bundle_definition_id,
      expected_previous_projection_checksum: previousProjection.checksum,
      target_revision_id: input.revision.revision_id,
      target_projection_checksum: projection.checksum,
      publication_id: input.publication_id,
      previous_projection: previousProjection,
    });
    return { attempted: true, success: true, reason: null };
  } catch (error) {
    return {
      attempted: true,
      success: false,
      reason: normalizeBundlePersistenceError(error).message,
    };
  }
}

function publicationRecord(input, projection, result) {
  return {
    schema_version: PREBUILT_BUNDLE_PROJECTION_PUBLICATION_SCHEMA_VERSION,
    publication_id: input.publication_id,
    bundle_definition_id: input.definition.bundle_definition_id,
    revision_id: input.revision.revision_id,
    projection_checksum: projection.checksum,
    source_snapshot_checksum: projection.source_snapshot_checksum,
    created_at: input.at,
    result,
  };
}

function isMatchingCompletedRecord(record, input) {
  return record?.schema_version === PREBUILT_BUNDLE_PROJECTION_PUBLICATION_SCHEMA_VERSION
    && record.publication_id === input.publication_id
    && record.bundle_definition_id === input.definition?.bundle_definition_id
    && record.revision_id === input.revision?.revision_id
    && record.result?.success === true;
}

function assertInput(input) {
  for (const field of ["publication_id", "at"]) {
    if (typeof input?.[field] !== "string" || input[field].trim() === "") {
      throw new BundlePersistenceError("WRITE_FAILED", `${field} must be a non-empty string`);
    }
  }
}

function assertDependencies(dependencies) {
  const persistence = dependencies?.persistence;
  const required = [
    "readPublicationById",
    "writePublicationRecord",
    "readPrebuiltExpandProjection",
    "writePrebuiltExpandProjection",
    "restorePreviousPrebuiltExpandProjection",
  ];
  const missing = required.filter((method) => typeof persistence?.[method] !== "function");
  if (missing.length > 0) {
    throw new BundlePersistenceError(
      "UNSUPPORTED_CAPABILITY",
      `projection publication persistence is missing: ${missing.join(", ")}`,
    );
  }
  return persistence;
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
