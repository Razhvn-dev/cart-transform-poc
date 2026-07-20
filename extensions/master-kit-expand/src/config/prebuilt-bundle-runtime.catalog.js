import { validateBundleDomain } from "./bundle-domain.validator.js";
import { PREBUILT_BUNDLE_RUNTIME_ASSIGNMENT_SCHEMA_VERSION } from "./prebuilt-bundle-runtime.assignment.js";
import { derivePrebuiltBundleRuntimeMapping } from "./prebuilt-bundle-runtime.mapping.js";
import { PREBUILT_BUNDLE_RUNTIME_CATALOG_SCHEMA_VERSION } from "./prebuilt-bundle-runtime.catalog-lookup.js";

export { PREBUILT_BUNDLE_RUNTIME_CATALOG_SCHEMA_VERSION, findPrebuiltBundleRuntimeMapping } from "./prebuilt-bundle-runtime.catalog-lookup.js";

/**
 * Builds a read-only catalog of locally approved pre-built SKU mappings.
 * This is deliberately a data-preparation boundary, not a Function lookup.
 */
export function buildPrebuiltBundleRuntimeCatalog({
  definitions,
  revisions,
  snapshots_by_definition_id,
  assignments,
  pilot_scope,
} = {}) {
  const domainErrors = validateBundleDomain({ definitions, revisions });
  if (domainErrors.length > 0) return invalidCatalog(domainErrors);
  const assignmentsByDefinition = indexAssignments(assignments);
  if (assignmentsByDefinition.errors.length > 0) return invalidCatalog(assignmentsByDefinition.errors);

  const revisionsById = new Map(revisions.map((revision) => [revision.revision_id, revision]));
  const entries = [];
  const expandProjections = [];
  const unavailable = [];
  definitions.forEach((definition) => {
    if (definition.active_revision_id === null) {
      unavailable.push({ bundle_definition_id: definition.bundle_definition_id, reason: "NO_ACTIVE_REVISION" });
      return;
    }
    const assignment = assignmentsByDefinition.values.get(definition.bundle_definition_id);
    if (!isMatchingAssignment(assignment, definition)) {
      unavailable.push({ bundle_definition_id: definition.bundle_definition_id, reason: "INVALID_RUNTIME_ASSIGNMENT" });
      return;
    }
    const prepared = derivePrebuiltBundleRuntimeMapping({
      definition,
      revision: revisionsById.get(definition.active_revision_id),
      snapshot: snapshots_by_definition_id?.[definition.bundle_definition_id],
      fixed_selections: assignment.fixed_selections,
      pilot_scope,
    });
    if (prepared.status === "ready") {
      entries.push(prepared.mapping);
      expandProjections.push(prepared.expand_projection);
    } else {
      unavailable.push({
        bundle_definition_id: definition.bundle_definition_id,
        reason: prepared.reason,
        errors: prepared.errors,
      });
    }
  });

  entries.sort((left, right) => left.parent_variant_gid.localeCompare(right.parent_variant_gid));
  expandProjections.sort((left, right) => left.parent.variant_gid.localeCompare(right.parent.variant_gid));
  unavailable.sort((left, right) => left.bundle_definition_id.localeCompare(right.bundle_definition_id));
  return deepFreeze({
    schema_version: PREBUILT_BUNDLE_RUNTIME_CATALOG_SCHEMA_VERSION,
    status: "ready",
    entries,
    expand_projections: expandProjections,
    unavailable,
  });
}

function indexAssignments(assignments) {
  if (!Array.isArray(assignments)) return { values: new Map(), errors: ["assignments must be an array"] };
  const values = new Map();
  const errors = [];
  assignments.forEach((assignment, index) => {
    if (assignment?.schema_version !== PREBUILT_BUNDLE_RUNTIME_ASSIGNMENT_SCHEMA_VERSION
      || typeof assignment.bundle_definition_id !== "string") {
      errors.push(`assignments[${index}] is not a runtime assignment`);
      return;
    }
    if (values.has(assignment.bundle_definition_id)) {
      errors.push(`assignments contains duplicate bundle_definition_id ${assignment.bundle_definition_id}`);
      return;
    }
    values.set(assignment.bundle_definition_id, assignment);
  });
  return { values, errors };
}

function isMatchingAssignment(assignment, definition) {
  return assignment?.schema_version === PREBUILT_BUNDLE_RUNTIME_ASSIGNMENT_SCHEMA_VERSION
    && assignment.bundle_definition_id === definition.bundle_definition_id
    && assignment.parent_variant_gid === definition.parent_binding.variant_gid
    && assignment.fixed_selections != null
    && typeof assignment.target_fingerprint === "string"
    && assignment.target_fingerprint.length > 0
    && typeof assignment.fixed_selections === "object"
    && !Array.isArray(assignment.fixed_selections);
}

function invalidCatalog(errors) {
  return deepFreeze({
    schema_version: PREBUILT_BUNDLE_RUNTIME_CATALOG_SCHEMA_VERSION,
    status: "invalid",
    entries: [],
    expand_projections: [],
    unavailable: [],
    errors: [...errors],
  });
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
