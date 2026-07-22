import { publishRevision } from "./bundle-domain.lifecycle.js";
import { validatePrebuiltBundleExpandProjection } from "./prebuilt-bundle-expand-projection.js";
import { derivePrebuiltBundleRuntimeMapping } from "./prebuilt-bundle-runtime.mapping.js";
import { validateRuntimeSnapshot } from "./bundle-runtime.validator.js";

export const PREBUILT_PROJECTION_PUBLICATION_EVIDENCE_SCHEMA = "prebuilt_projection_publication_evidence.v1";

// Dev-pilot evidence for a real fixed SKU. It deliberately does not claim
// parity with the unrelated hard-coded Builder SKU; it proves that the exact
// draft can produce one checksum-valid, server-owned Projection instead.
export function buildPrebuiltProjectionPublicationEvidence({ definition, revision, revisions = [revision], snapshot, pilot_scope: pilotScope }) {
  if (revision?.status !== "draft") throw new Error("only a draft revision may produce publication evidence");
  if (validateRuntimeSnapshot(snapshot).length > 0) throw new Error("draft snapshot is invalid");
  const published = publishRevision({
    definition,
    revisions,
    revisionId: revision.revision_id,
    runtimeSnapshotRef: {
      schema_version: snapshot.snapshot_schema,
      checksum_algorithm: snapshot.checksum_algorithm,
      checksum: snapshot.checksum,
      configuration_version: snapshot.configuration_version,
    },
    updatedAt: revision.updated_at,
  });
  const candidate = derivePrebuiltBundleRuntimeMapping({
    definition: published.definition,
    revision: published.revisions.find((candidateRevision) => candidateRevision.revision_id === revision.revision_id),
    snapshot,
    fixed_selections: Object.fromEntries(snapshot.groups.map((group) => [group.key, group.default_option])),
    pilot_scope: pilotScope,
  });
  if (candidate.status !== "ready") throw new Error(`Projection preparation failed: ${candidate.reason}`);

  const evidence = {
    schema_version: PREBUILT_PROJECTION_PUBLICATION_EVIDENCE_SCHEMA,
    bundle_definition_id: definition.bundle_definition_id,
    revision_id: revision.revision_id,
    parent_product_gid: definition.parent_binding.product_gid,
    parent_variant_gid: definition.parent_binding.variant_gid,
    snapshot_checksum: snapshot.checksum,
    projection_checksum: candidate.expand_projection.checksum,
    fixed_selections: candidate.mapping.fixed_selections,
    components: candidate.expand_projection.components.map((component) => ({
      sequence: component.sequence,
      variant_gid: component.variant_gid,
      fixed_price_per_unit: component.fixed_price_per_unit,
    })),
  };
  assertPrebuiltProjectionPublicationEvidence(evidence, { definition, revision, snapshot, projection: candidate.expand_projection });
  return Object.freeze({ evidence: deepFreeze(evidence), projection: candidate.expand_projection, mapping: candidate.mapping });
}

export function assertPrebuiltProjectionPublicationEvidence(evidence, { definition, revision, snapshot, projection }) {
  if (!isObject(evidence) || evidence.schema_version !== PREBUILT_PROJECTION_PUBLICATION_EVIDENCE_SCHEMA) {
    throw new Error("Projection publication evidence schema is invalid");
  }
  const expected = {
    bundle_definition_id: definition?.bundle_definition_id,
    revision_id: revision?.revision_id,
    parent_product_gid: definition?.parent_binding?.product_gid,
    parent_variant_gid: definition?.parent_binding?.variant_gid,
    snapshot_checksum: snapshot?.checksum,
    projection_checksum: projection?.checksum,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (evidence[key] !== value) throw new Error(`Projection publication evidence ${key} does not match`);
  }
  if (validatePrebuiltBundleExpandProjection(projection).length > 0) throw new Error("Projection is invalid");
  if (JSON.stringify(evidence.fixed_selections) !== JSON.stringify(Object.fromEntries(snapshot.groups.map((group) => [group.key, group.default_option])))) {
    throw new Error("Projection publication evidence selections do not match Snapshot defaults");
  }
  const components = projection.components.map(({ sequence, variant_gid, fixed_price_per_unit }) => ({ sequence, variant_gid, fixed_price_per_unit }));
  if (JSON.stringify(evidence.components) !== JSON.stringify(components)) throw new Error("Projection publication evidence components do not match");
  return true;
}

function isObject(value) { return value != null && typeof value === "object" && !Array.isArray(value); }
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
