import { calculateRuntimeSnapshotChecksum } from "./bundle-runtime.checksum.js";
import { PRODUCT_GID_REGEX, PRODUCT_VARIANT_GID_REGEX } from "./bundle-config.schema.js";
import { PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION } from "./prebuilt-bundle-import.plan.js";
import {
  DEFAULT_PREBUILT_IMPORT_MAX_RECORDS,
  createPrebuiltBundleImportSourceAdapter,
} from "./prebuilt-bundle-import.source-adapter.js";

export const PREBUILT_BUNDLE_SOURCE_MAPPING_SCHEMA_VERSION = "prebuilt_bundle_source_mapping.v1";

export class PrebuiltBundleDeclarativeSourceError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "PrebuiltBundleDeclarativeSourceError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Converts an arbitrary JSON export through an explicit, data-only mapping
 * profile. Paths can only select existing object keys; no expressions, code,
 * coercion, ID construction, or Shopify writes are supported.
 */
export function createDeclarativePrebuiltBundleSourceAdapter({
  profile,
  export_document,
  max_records = DEFAULT_PREBUILT_IMPORT_MAX_RECORDS,
} = {}) {
  const normalizedProfile = parseMappingProfile(profile);
  const rawRecords = readRecords(export_document, normalizedProfile.records_path);
  if (!Number.isInteger(max_records) || max_records < 1) {
    throw new PrebuiltBundleDeclarativeSourceError("INVALID_MAX_RECORDS", "max_records must be a positive integer");
  }
  if (rawRecords.length > max_records) {
    throw new PrebuiltBundleDeclarativeSourceError("MAX_RECORDS_EXCEEDED", `source export exceeds ${max_records} records before conversion`);
  }
  const canonicalRecords = rawRecords.map((record, index) => convertRecord(record, index, normalizedProfile));
  assertUniqueSourceIds(canonicalRecords);

  const sourceExport = deepFreeze({
    source_system: normalizedProfile.source_system,
    collection_mode: "declarative_read_only_json_export",
    mapping_schema_version: PREBUILT_BUNDLE_SOURCE_MAPPING_SCHEMA_VERSION,
    mapping_profile_fingerprint: calculateRuntimeSnapshotChecksum(normalizedProfile),
    raw_export_fingerprint: calculateRuntimeSnapshotChecksum(export_document),
    record_count: canonicalRecords.length,
  });

  return createPrebuiltBundleImportSourceAdapter({
    source_system: normalizedProfile.source_system,
    source_export: sourceExport,
    async list_records({ cursor, page_size }) {
      const offset = cursor === null ? 0 : parseCursor(cursor, canonicalRecords.length);
      const records = canonicalRecords.slice(offset, offset + page_size);
      const nextOffset = offset + records.length;
      return {
        records,
        next_cursor: nextOffset < canonicalRecords.length ? String(nextOffset) : null,
      };
    },
  });
}

export function parseMappingProfile(input) {
  if (!isPlainObject(input)) throw invalidProfile("mapping profile must be an object");
  assertAllowedKeys(input, ["schema_version", "source_system", "records_path", "fields", "components"], "mapping profile");
  if (input.schema_version !== PREBUILT_BUNDLE_SOURCE_MAPPING_SCHEMA_VERSION) {
    throw invalidProfile(`schema_version must be ${PREBUILT_BUNDLE_SOURCE_MAPPING_SCHEMA_VERSION}`);
  }
  requireString(input.source_system, "source_system");
  validateOptionalPath(input.records_path, "records_path");
  if (!isPlainObject(input.fields)) throw invalidProfile("fields must be an object");
  assertAllowedKeys(input.fields, [
    "source_bundle_id", "source_checksum", "product_series_key", "parent_product_gid", "parent_variant_gid",
  ], "fields");
  for (const field of ["source_bundle_id", "product_series_key", "parent_product_gid", "parent_variant_gid"]) {
    validateRequiredPath(input.fields[field], `fields.${field}`);
  }
  validateOptionalPath(input.fields.source_checksum, "fields.source_checksum");
  if (!isPlainObject(input.components)) throw invalidProfile("components must be an object");
  assertAllowedKeys(input.components, ["path", "variant_gid", "quantity", "default_quantity"], "components");
  validateRequiredPath(input.components.path, "components.path");
  validateRequiredPath(input.components.variant_gid, "components.variant_gid");
  validateOptionalPath(input.components.quantity, "components.quantity");
  if (input.components.default_quantity !== undefined && input.components.default_quantity !== 1) {
    throw invalidProfile("components.default_quantity must be 1 when supplied");
  }

  return deepFreeze({
    schema_version: PREBUILT_BUNDLE_SOURCE_MAPPING_SCHEMA_VERSION,
    source_system: input.source_system.trim(),
    records_path: input.records_path?.trim() || null,
    fields: {
      source_bundle_id: input.fields.source_bundle_id.trim(),
      source_checksum: input.fields.source_checksum?.trim() || null,
      product_series_key: input.fields.product_series_key.trim(),
      parent_product_gid: input.fields.parent_product_gid.trim(),
      parent_variant_gid: input.fields.parent_variant_gid.trim(),
    },
    components: {
      path: input.components.path.trim(),
      variant_gid: input.components.variant_gid.trim(),
      quantity: input.components.quantity?.trim() || null,
      default_quantity: 1,
    },
  });
}

function convertRecord(rawRecord, index, profile) {
  if (!isPlainObject(rawRecord)) throw conversionError(index, "record", "record must be an object");
  const components = readPath(rawRecord, profile.components.path, `records[${index}].components`);
  if (!Array.isArray(components) || components.length === 0) {
    throw conversionError(index, profile.components.path, "components path must resolve to a non-empty array");
  }
  const sourceBundleId = readRequiredString(rawRecord, profile.fields.source_bundle_id, index);
  const sourceChecksum = profile.fields.source_checksum
    ? readRequiredString(rawRecord, profile.fields.source_checksum, index)
    : calculateRuntimeSnapshotChecksum(rawRecord);
  const parentProductGid = readRequiredString(rawRecord, profile.fields.parent_product_gid, index);
  const parentVariantGid = readRequiredString(rawRecord, profile.fields.parent_variant_gid, index);
  assertGid(parentProductGid, PRODUCT_GID_REGEX, index, profile.fields.parent_product_gid, "Shopify Product GID");
  assertGid(parentVariantGid, PRODUCT_VARIANT_GID_REGEX, index, profile.fields.parent_variant_gid, "Shopify ProductVariant GID");

  return deepFreeze({
    schema_version: PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION,
    source_system: profile.source_system,
    source_bundle_id: sourceBundleId,
    source_checksum: sourceChecksum,
    product_series_key: readRequiredString(rawRecord, profile.fields.product_series_key, index),
    parent_binding: {
      product_gid: parentProductGid,
      variant_gid: parentVariantGid,
    },
    components: components.map((component, componentIndex) => {
      if (!isPlainObject(component)) {
        throw conversionError(index, `${profile.components.path}[${componentIndex}]`, "component must be an object");
      }
      const quantity = profile.components.quantity
        ? readPath(component, profile.components.quantity, `records[${index}].components[${componentIndex}].quantity`)
        : profile.components.default_quantity;
      if (quantity !== 1) {
        throw conversionError(index, `${profile.components.path}[${componentIndex}]`, "only component quantity 1 is supported");
      }
      const variantGid = readRequiredString(component, profile.components.variant_gid, index, componentIndex);
      assertGid(variantGid, PRODUCT_VARIANT_GID_REGEX, index, profile.components.variant_gid, "Shopify ProductVariant GID");
      return {
        variant_gid: variantGid,
        quantity,
      };
    }),
  });
}

function readRecords(document, recordsPath) {
  const records = recordsPath ? readPath(document, recordsPath, "records_path") : document;
  if (!Array.isArray(records)) {
    throw new PrebuiltBundleDeclarativeSourceError("INVALID_EXPORT", "records_path must resolve to an array");
  }
  return records;
}

function readRequiredString(value, path, recordIndex, componentIndex = null) {
  const label = componentIndex === null
    ? `records[${recordIndex}].${path}`
    : `records[${recordIndex}].components[${componentIndex}].${path}`;
  const resolved = readPath(value, path, label);
  if (typeof resolved !== "string" || resolved.trim() === "") {
    throw conversionError(recordIndex, path, `${label} must resolve to a non-empty string`);
  }
  return resolved.trim();
}

function readPath(value, path, label) {
  let current = value;
  for (const segment of path.split(".")) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new PrebuiltBundleDeclarativeSourceError("MISSING_SOURCE_FIELD", `${label} is missing`, { path, label });
    }
    current = current[segment];
  }
  return current;
}

function assertUniqueSourceIds(records) {
  const seen = new Set();
  records.forEach((record, index) => {
    if (seen.has(record.source_bundle_id)) {
      throw conversionError(index, "source_bundle_id", `duplicate source_bundle_id ${record.source_bundle_id}`);
    }
    seen.add(record.source_bundle_id);
  });
}

function assertGid(value, pattern, recordIndex, path, label) {
  if (!pattern.test(value)) throw conversionError(recordIndex, path, `${path} must resolve to a full ${label}`);
}

function parseCursor(cursor, recordCount) {
  if (!/^\d+$/.test(cursor)) throw new PrebuiltBundleDeclarativeSourceError("INVALID_CURSOR", "cursor must be a decimal offset");
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= recordCount) {
    throw new PrebuiltBundleDeclarativeSourceError("INVALID_CURSOR", "cursor is outside the export boundary");
  }
  return offset;
}

function validateRequiredPath(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw invalidProfile(`${field} must be a non-empty JSON object path`);
  validatePath(value, field);
}

function validateOptionalPath(value, field) {
  if (value === undefined || value === null || value === "") return;
  validateRequiredPath(value, field);
}

function validatePath(value, field) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$-]*(?:\.[A-Za-z_$][A-Za-z0-9_$-]*)*$/.test(value.trim())) {
    throw invalidProfile(`${field} contains an unsupported path; only dot-separated object keys are allowed`);
  }
  if (value.split(".").some((segment) => ["__proto__", "prototype", "constructor"].includes(segment))) {
    throw invalidProfile(`${field} contains a prohibited object key`);
  }
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw invalidProfile(`${field} must be a non-empty string`);
}

function assertAllowedKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw invalidProfile(`${label} contains unsupported fields: ${unexpected.join(", ")}`);
}

function invalidProfile(message) {
  return new PrebuiltBundleDeclarativeSourceError("INVALID_MAPPING_PROFILE", message);
}

function conversionError(recordIndex, path, message) {
  return new PrebuiltBundleDeclarativeSourceError("SOURCE_CONVERSION_FAILED", message, { record_index: recordIndex, path });
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
