import { stableSerialize, calculateRuntimeSnapshotChecksum } from "./bundle-runtime.checksum.js";
import { createPrebuiltBundleImportPlan } from "./prebuilt-bundle-import.plan.js";

export const PREBUILT_BUNDLE_IMPORT_PACKAGE_SCHEMA_VERSION = "prebuilt_bundle_import_package.v1";

/**
 * Parses the portable, source-neutral input for an import review. Semantic
 * source/mapping validation remains owned by the dry-run planner.
 */
export function parsePrebuiltBundleImportPackage(input) {
  let value;
  try {
    value = typeof input === "string" ? JSON.parse(input) : structuredClone(input);
  } catch {
    return invalidPackage(["Import package contains invalid JSON."]);
  }

  const errors = [];
  if (!isPlainObject(value)) return invalidPackage(["Import package must be a JSON object."]);
  if (value.schema_version !== PREBUILT_BUNDLE_IMPORT_PACKAGE_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${PREBUILT_BUNDLE_IMPORT_PACKAGE_SCHEMA_VERSION}.`);
  }
  if (typeof value.import_id !== "string" || value.import_id.trim() === "") errors.push("import_id is required.");
  if (!Array.isArray(value.source_records)) errors.push("source_records must be an array.");
  if (!Array.isArray(value.mappings)) errors.push("mappings must be an array.");
  if (!isPlainObject(value.pilot_scope)) errors.push("pilot_scope must be an object.");
  if (value.source_export != null && !isPlainObject(value.source_export)) {
    errors.push("source_export must be an object when supplied.");
  }
  findReservedKeys(value).forEach((path) => errors.push(`${path} is reserved and must not appear in an import package.`));

  if (errors.length > 0) return invalidPackage(errors);
  const packageValue = {
    schema_version: PREBUILT_BUNDLE_IMPORT_PACKAGE_SCHEMA_VERSION,
    import_id: value.import_id,
    source_records: value.source_records,
    mappings: value.mappings,
    pilot_scope: value.pilot_scope,
    ...(value.source_export == null ? {} : { source_export: value.source_export }),
  };
  return Object.freeze({
    ok: true,
    value: deepFreeze(packageValue),
    fingerprint: calculateRuntimeSnapshotChecksum(packageValue),
    errors: Object.freeze([]),
  });
}

export function createPrebuiltBundleImportPlanFromPackage(input, {
  existing_parent_variant_gids = [],
  existing_parent_bindings = [],
} = {}) {
  const parsed = parsePrebuiltBundleImportPackage(input);
  if (!parsed.ok) return Object.freeze({ ok: false, errors: parsed.errors, plan: null, fingerprint: null });
  const plan = createPrebuiltBundleImportPlan({
    ...parsed.value,
    existing_parent_variant_gids,
    existing_parent_bindings,
  });
  return Object.freeze({ ok: true, errors: Object.freeze([]), plan, fingerprint: parsed.fingerprint });
}

export function serializePrebuiltBundleImportPackage(packageValue) {
  const parsed = parsePrebuiltBundleImportPackage(packageValue);
  if (!parsed.ok) throw new Error(parsed.errors.join(" "));
  return stableSerialize(parsed.value);
}

function invalidPackage(errors) {
  return Object.freeze({ ok: false, value: null, fingerprint: null, errors: Object.freeze(errors) });
}

function findReservedKeys(value, path = "") {
  if (Array.isArray(value)) return value.flatMap((item, index) => findReservedKeys(item, `${path}[${index}]`));
  if (!isPlainObject(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const currentPath = path ? `${path}.${key}` : key;
    const reserved = key === "_bundle_id" || key === "bundle_id" ? [currentPath] : [];
    return [...reserved, ...findReservedKeys(item, currentPath)];
  });
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
