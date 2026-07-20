import { parseBundleDefinition, parseBundleRevision } from "./bundle-domain.parser.js";
import { calculateRuntimeSnapshotChecksum } from "./bundle-runtime.checksum.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { createPrebuiltBundleRuntimeAssignments } from "./prebuilt-bundle-runtime.assignment.js";
import { derivePrebuiltBundleRuntimeMapping } from "./prebuilt-bundle-runtime.mapping.js";

/**
 * Compiles one reviewed import record into the complete persistence payload.
 * This function is pure and performs no Shopify or repository writes.
 */
export function compilePrebuiltBundleImportTarget({ record, pilot_scope, revision_id, created_at, created_by } = {}) {
  if (record?.status !== "ready_for_confirmation") return unavailable("IMPORT_RECORD_NOT_READY");
  const target = record.target;
  const targetFingerprint = calculateRuntimeSnapshotChecksum({ target });
  if (targetFingerprint !== record.target_fingerprint) return unavailable("TARGET_FINGERPRINT_MISMATCH");

  try {
    const snapshot = compileRuntimeSnapshot(target.configuration);
    const definition = parseBundleDefinition({
      schema_version: "bundle_definition.v1",
      bundle_definition_id: target.bundle_definition_id,
      slug: target.configuration.slug,
      parent_binding: structuredClone(target.parent_binding),
      active_revision_id: revision_id,
      created_at,
      updated_at: created_at,
    });
    const revision = parseBundleRevision({
      schema_version: "bundle_revision.v1",
      revision_id,
      bundle_definition_id: target.bundle_definition_id,
      revision_number: target.configuration.configuration_version,
      status: "published",
      configuration: structuredClone(target.configuration),
      runtime_snapshot_ref: {
        schema_version: snapshot.snapshot_schema,
        checksum_algorithm: snapshot.checksum_algorithm,
        checksum: snapshot.checksum,
        configuration_version: snapshot.configuration_version,
      },
      created_at,
      updated_at: created_at,
      created_by,
    });
    const assignments = createPrebuiltBundleRuntimeAssignments({
      import_plan: { records: [record] },
      pilot_scope,
    });
    if (assignments.status !== "ready" || assignments.assignments.length !== 1) {
      return unavailable(assignments.unavailable?.[0]?.reason ?? "RUNTIME_ASSIGNMENT_UNAVAILABLE");
    }
    const runtime = derivePrebuiltBundleRuntimeMapping({
      definition,
      revision,
      snapshot,
      fixed_selections: target.fixed_selections,
      pilot_scope,
    });
    if (runtime.status !== "ready") return unavailable(runtime.reason, runtime.errors);

    return deepFreeze({
      status: "ready",
      definition,
      revision,
      snapshot,
      assignment: assignments.assignments[0],
      mapping: runtime.mapping,
      expand_projection: runtime.expand_projection,
    });
  } catch (error) {
    return unavailable("TARGET_DOCUMENTS_INVALID", [error instanceof Error ? error.message : String(error)]);
  }
}

function unavailable(reason, errors = []) {
  return deepFreeze({ status: "unavailable", reason, errors: [...errors] });
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
