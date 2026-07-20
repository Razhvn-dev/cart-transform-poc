import { PRODUCT_VARIANT_GID_REGEX } from "./bundle-config.schema.js";
import { validateBundleDomain } from "./bundle-domain.validator.js";
import { validateRuntimeSnapshot } from "./bundle-runtime.validator.js";
import { validatePilotScope } from "./prebuilt-bundle-import.plan.js";
import {
  PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION,
  resolvePrebuiltBundleSelection,
} from "./prebuilt-bundle-runtime.selection.js";
import { compilePrebuiltBundleExpandProjection } from "./prebuilt-bundle-expand-projection.js";

/**
 * Builds the server-owned fixed-selection mapping for a published pre-built SKU.
 * Pilot membership is explicit input so an unpublished or out-of-scope Variant
 * never becomes a runtime candidate merely because it has a BundleDefinition.
 */
export function derivePrebuiltBundleRuntimeMapping({
  definition,
  revision,
  snapshot,
  fixed_selections,
  pilot_scope,
} = {}) {
  const domainErrors = validateBundleDomain({ definitions: [definition], revisions: [revision] });
  if (domainErrors.length > 0) return unavailable("INVALID_DOMAIN", domainErrors);
  if (definition.active_revision_id !== revision.revision_id || revision.status !== "published") {
    return unavailable("INACTIVE_OR_UNPUBLISHED_REVISION");
  }

  const snapshotErrors = validateRuntimeSnapshot(snapshot);
  if (snapshotErrors.length > 0) return unavailable("INVALID_SNAPSHOT", snapshotErrors);
  if (snapshot.configuration_id !== definition.bundle_definition_id) {
    return unavailable("SNAPSHOT_CONFIGURATION_MISMATCH");
  }
  if (snapshot.parent.variant_gid !== definition.parent_binding.variant_gid) {
    return unavailable("SNAPSHOT_PARENT_VARIANT_MISMATCH");
  }
  if (snapshot.checksum !== revision.runtime_snapshot_ref?.checksum) {
    return unavailable("SNAPSHOT_CHECKSUM_MISMATCH");
  }
  if (snapshot.configuration_version !== revision.runtime_snapshot_ref?.configuration_version) {
    return unavailable("SNAPSHOT_VERSION_MISMATCH");
  }
  if (!isPilotApproved(pilot_scope, definition.parent_binding.variant_gid)) {
    return unavailable("PILOT_SCOPE_NOT_APPROVED");
  }

  const mapping = {
    schema_version: PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION,
    parent_variant_gid: definition.parent_binding.variant_gid,
    bundle_definition_id: definition.bundle_definition_id,
    published_revision_id: revision.revision_id,
    status: "published",
    pilot_scope_approved: true,
    snapshot_checksum: snapshot.checksum,
    fixed_selections: structuredClone(fixed_selections),
  };
  const resolved = resolvePrebuiltBundleSelection({
    parent_variant_gid: mapping.parent_variant_gid,
    mapping,
    snapshot,
  });
  if (resolved.status !== "resolved") return unavailable(resolved.reason, resolved.errors);

  const projection = compilePrebuiltBundleExpandProjection({
    mapping,
    resolved_candidate: resolved.resolved,
  });
  if (projection.status !== "ready") return unavailable(projection.reason, projection.errors);

  return deepFreeze({
    status: "ready",
    mapping,
    resolved_candidate: structuredClone(resolved.resolved),
    expand_projection: structuredClone(projection.projection),
  });
}

function isPilotApproved(pilotScope, parentVariantGid) {
  if (validatePilotScope(pilotScope).length > 0) return false;
  return pilotScope.approved_parent_variant_gids.some((variantGid) => (
    typeof variantGid === "string"
    && PRODUCT_VARIANT_GID_REGEX.test(variantGid)
    && variantGid === parentVariantGid
  ));
}

function unavailable(reason, errors = []) {
  return deepFreeze({ status: "unavailable", reason, errors: [...errors], mapping: null, resolved_candidate: null });
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
