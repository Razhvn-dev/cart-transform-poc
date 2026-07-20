import { UUID_REGEX } from "./bundle-config.schema.js";
import { validatePilotScope } from "./prebuilt-bundle-import.plan.js";

export const PREBUILT_BUNDLE_RUNTIME_ASSIGNMENT_SCHEMA_VERSION = "prebuilt_bundle_runtime_assignment.v1";

/**
 * Converts reviewed, ready import-plan records into immutable runtime assignments.
 * This remains local-only: it does not create Definitions, publish Revisions, or
 * read/write Shopify. A later persistence adapter may provide the same shape.
 */
export function createPrebuiltBundleRuntimeAssignments({ import_plan, pilot_scope } = {}) {
  const pilotErrors = validatePilotScope(pilot_scope);
  if (pilotErrors.length > 0) return invalid(pilotErrors);
  if (!Array.isArray(import_plan?.records)) return invalid(["import_plan.records must be an array"]);

  const claimedDefinitions = new Set();
  const claimedVariants = new Set();
  const assignments = [];
  const unavailable = [];
  for (const record of import_plan.records) {
    const result = assignmentFromRecord(record, pilot_scope, claimedDefinitions, claimedVariants);
    if (result.assignment) assignments.push(result.assignment);
    else unavailable.push({ source_identity: record?.source_identity ?? null, reason: result.reason });
  }
  assignments.sort((left, right) => left.parent_variant_gid.localeCompare(right.parent_variant_gid));
  unavailable.sort((left, right) => String(left.source_identity).localeCompare(String(right.source_identity)));
  return deepFreeze({
    schema_version: PREBUILT_BUNDLE_RUNTIME_ASSIGNMENT_SCHEMA_VERSION,
    status: "ready",
    assignments,
    unavailable,
  });
}

function assignmentFromRecord(record, pilotScope, claimedDefinitions, claimedVariants) {
  if (!isPlainObject(record) || record.status !== "ready_for_confirmation") {
    return { reason: "IMPORT_RECORD_NOT_READY" };
  }
  const target = record.target;
  const source = record.source;
  if (!isUuid(target?.bundle_definition_id) || !isNonEmptyString(target?.parent_binding?.variant_gid)
    || !isPlainObject(target.fixed_selections) || !isNonEmptyString(record.source_identity)
    || !isNonEmptyString(record.source_fingerprint)
    || !isNonEmptyString(record.target_fingerprint)) {
    return { reason: "INVALID_IMPORT_RECORD" };
  }
  if (!pilotScope.approved_product_series_keys.includes(source?.product_series_key)
    || !pilotScope.approved_parent_variant_gids.includes(target.parent_binding.variant_gid)) {
    return { reason: "PILOT_SCOPE_NOT_APPROVED" };
  }
  if (claimedDefinitions.has(target.bundle_definition_id) || claimedVariants.has(target.parent_binding.variant_gid)) {
    return { reason: "DUPLICATE_RUNTIME_ASSIGNMENT" };
  }
  claimedDefinitions.add(target.bundle_definition_id);
  claimedVariants.add(target.parent_binding.variant_gid);
  return {
    assignment: deepFreeze({
      schema_version: PREBUILT_BUNDLE_RUNTIME_ASSIGNMENT_SCHEMA_VERSION,
      source_identity: record.source_identity,
      source_fingerprint: record.source_fingerprint,
      target_fingerprint: record.target_fingerprint,
      bundle_definition_id: target.bundle_definition_id,
      parent_variant_gid: target.parent_binding.variant_gid,
      fixed_selections: structuredClone(target.fixed_selections),
      pilot_scope_id: pilotScope.pilot_scope_id,
    }),
  };
}

function invalid(errors) {
  return deepFreeze({
    schema_version: PREBUILT_BUNDLE_RUNTIME_ASSIGNMENT_SCHEMA_VERSION,
    status: "invalid",
    assignments: [],
    unavailable: [],
    errors: [...errors],
  });
}

function isUuid(value) {
  return typeof value === "string" && UUID_REGEX.test(value);
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
