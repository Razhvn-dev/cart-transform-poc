export const BUNDLE_PERSISTENCE_METHODS = Object.freeze([
  "readBundleDefinition",
  "writeBundleDefinition",
  "readRevision",
  "writeRevision",
  "readRuntimeSnapshot",
  "writeRuntimeSnapshot",
  "compareAndSetActiveRevision",
  "writePublicationRecord",
  "readPublicationById",
  "restorePreviousSnapshot",
]);

export const BUNDLE_PERSISTENCE_ERROR_CODES = new Set([
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "POINTER_DRIFT",
  "CHECKSUM_MISMATCH",
  "WRITE_FAILED",
  "READ_BACK_FAILED",
  "AUDIT_FAILED",
  "RETRY_CONFLICT",
  "UNSUPPORTED_CAPABILITY",
]);

export class BundlePersistenceError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "BundlePersistenceError";
    this.code = code;
    this.details = details;
  }
}

export function assertBundlePersistenceAdapter(adapter) {
  const missing = BUNDLE_PERSISTENCE_METHODS.filter(
    (method) => typeof adapter?.[method] !== "function",
  );
  if (missing.length > 0) {
    throw new BundlePersistenceError(
      "UNSUPPORTED_CAPABILITY",
      `adapter is missing required methods: ${missing.join(", ")}`,
      { missing },
    );
  }
  return adapter;
}

export function normalizeBundlePersistenceError(error, fallbackCode = "WRITE_FAILED") {
  if (error instanceof BundlePersistenceError) return error;
  return new BundlePersistenceError(
    BUNDLE_PERSISTENCE_ERROR_CODES.has(error?.code) ? error.code : fallbackCode,
    error instanceof Error ? error.message : String(error),
  );
}

export function assertActiveRevisionCasInput(input) {
  assertString(input?.bundle_definition_id, "bundle_definition_id");
  assertNullableString(input?.expected_active_revision_id, "expected_active_revision_id");
  assertString(input?.target_revision_id, "target_revision_id");
  assertString(input?.publication_id, "publication_id");
}

export function assertSnapshotCasInput(input) {
  assertString(input?.bundle_definition_id, "bundle_definition_id");
  assertNullableString(input?.expected_previous_snapshot_checksum, "expected_previous_snapshot_checksum");
  assertString(input?.target_revision_id, "target_revision_id");
  assertString(input?.target_snapshot_checksum, "target_snapshot_checksum");
  assertString(input?.publication_id, "publication_id");
}

function assertString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BundlePersistenceError("WRITE_FAILED", `${field} must be a non-empty string`);
  }
}

function assertNullableString(value, field) {
  if (value !== null && (typeof value !== "string" || value.trim() === "")) {
    throw new BundlePersistenceError("WRITE_FAILED", `${field} must be a string or null`);
  }
}
