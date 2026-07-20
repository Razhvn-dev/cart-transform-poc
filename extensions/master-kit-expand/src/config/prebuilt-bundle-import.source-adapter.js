import { PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION } from "./prebuilt-bundle-import.plan.js";

export const DEFAULT_PREBUILT_IMPORT_PAGE_SIZE = 100;
export const DEFAULT_PREBUILT_IMPORT_MAX_RECORDS = 10_000;

export class PrebuiltBundleImportSourceAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PrebuiltBundleImportSourceAdapterError";
    this.code = code;
  }
}

/**
 * Wraps a source-specific, read-only pagination function in the canonical
 * import contract. Vendor APIs and export formats stay outside this module.
 */
export function createPrebuiltBundleImportSourceAdapter({ source_system, list_records, source_export = null }) {
  if (!isNonEmptyString(source_system)) {
    throw new PrebuiltBundleImportSourceAdapterError("INVALID_SOURCE_SYSTEM", "source_system must be a non-empty string.");
  }
  if (typeof list_records !== "function") {
    throw new PrebuiltBundleImportSourceAdapterError("INVALID_LIST_RECORDS", "list_records must be a function.");
  }
  if (source_export !== null && !isPlainObject(source_export)) {
    throw new PrebuiltBundleImportSourceAdapterError("INVALID_SOURCE_EXPORT", "source_export must be an object when supplied.");
  }
  if (source_export?.source_system !== undefined && source_export.source_system !== source_system) {
    throw new PrebuiltBundleImportSourceAdapterError("SOURCE_SYSTEM_MISMATCH", "source_export.source_system must match source_system.");
  }

  return Object.freeze({
    source_system,
    source_export: source_export === null ? null : deepFreeze(structuredClone(source_export)),
    async listRecords({ cursor = null, page_size = DEFAULT_PREBUILT_IMPORT_PAGE_SIZE } = {}) {
      validatePageRequest({ cursor, page_size });
      const page = await list_records({ cursor, page_size });
      return normalizePage(page, source_system);
    },
  });
}

/**
 * Collects a bounded, ordered source export. It is intentionally read-only
 * and produces canonical records for the package/planner layer only.
 */
export async function collectPrebuiltBundleImportSourceRecords({
  adapter,
  page_size = DEFAULT_PREBUILT_IMPORT_PAGE_SIZE,
  max_records = DEFAULT_PREBUILT_IMPORT_MAX_RECORDS,
} = {}) {
  if (!adapter || typeof adapter.listRecords !== "function") {
    throw new PrebuiltBundleImportSourceAdapterError("INVALID_ADAPTER", "adapter.listRecords must be a function.");
  }
  validatePageRequest({ cursor: null, page_size });
  if (!Number.isInteger(max_records) || max_records < 1) {
    throw new PrebuiltBundleImportSourceAdapterError("INVALID_MAX_RECORDS", "max_records must be a positive integer.");
  }

  const records = [];
  const seenCursors = new Set();
  let cursor = null;

  do {
    if (cursor !== null) {
      if (seenCursors.has(cursor)) {
        throw new PrebuiltBundleImportSourceAdapterError("REPEATED_CURSOR", `Source adapter repeated cursor ${cursor}.`);
      }
      seenCursors.add(cursor);
    }

    const page = await adapter.listRecords({ cursor, page_size });
    records.push(...page.records);
    if (records.length > max_records) {
      throw new PrebuiltBundleImportSourceAdapterError("MAX_RECORDS_EXCEEDED", `Source export exceeds ${max_records} records.`);
    }
    cursor = page.next_cursor;
  } while (cursor !== null);

  return deepFreeze(structuredClone(records));
}

function normalizePage(page, sourceSystem) {
  if (!isPlainObject(page) || !Array.isArray(page.records)) {
    throw new PrebuiltBundleImportSourceAdapterError("INVALID_PAGE", "Source adapter must return an object with a records array.");
  }
  if (page.next_cursor !== undefined && page.next_cursor !== null && !isNonEmptyString(page.next_cursor)) {
    throw new PrebuiltBundleImportSourceAdapterError("INVALID_CURSOR", "next_cursor must be null or a non-empty string.");
  }

  const records = page.records.map((record, index) => normalizeSourceRecord(record, index, sourceSystem));
  return deepFreeze({
    records,
    next_cursor: page.next_cursor ?? null,
  });
}

function normalizeSourceRecord(record, index, sourceSystem) {
  if (!isPlainObject(record)) {
    throw new PrebuiltBundleImportSourceAdapterError("INVALID_SOURCE_RECORD", `records[${index}] must be an object.`);
  }
  if (record.schema_version !== PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION) {
    throw new PrebuiltBundleImportSourceAdapterError("INVALID_SOURCE_SCHEMA", `records[${index}].schema_version must be ${PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION}.`);
  }
  if (record.source_system !== sourceSystem) {
    throw new PrebuiltBundleImportSourceAdapterError("SOURCE_SYSTEM_MISMATCH", `records[${index}].source_system must match ${sourceSystem}.`);
  }
  return deepFreeze(structuredClone(record));
}

function validatePageRequest({ cursor, page_size }) {
  if (cursor !== null && !isNonEmptyString(cursor)) {
    throw new PrebuiltBundleImportSourceAdapterError("INVALID_CURSOR", "cursor must be null or a non-empty string.");
  }
  if (!Number.isInteger(page_size) || page_size < 1) {
    throw new PrebuiltBundleImportSourceAdapterError("INVALID_PAGE_SIZE", "page_size must be a positive integer.");
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
