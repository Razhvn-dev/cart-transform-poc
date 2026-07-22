import { describe, expect, it } from "vitest";

import { parseBundleDefinition, parseBundleRevision } from "./bundle-domain.parser.js";
import { createNextDraftRevision } from "./bundle-domain.lifecycle.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { assertPrebuiltProjectionPublicationEvidence, buildPrebuiltProjectionPublicationEvidence } from "./prebuilt-projection-publication-evidence.js";

function fixture() {
  const configuration = structuredClone(masterKitConfigV1);
  const definition = parseBundleDefinition({
    schema_version: "bundle_definition.v1", bundle_definition_id: "77770000-0000-4000-8000-000000000001",
    slug: "projection-pilot", parent_binding: { product_gid: masterKitConfigV1.parent.product_gid, variant_gid: masterKitConfigV1.parent.variant_gid },
    active_revision_id: null, created_at: "2026-07-21T00:00:00.000Z", updated_at: "2026-07-21T00:00:00.000Z",
  });
  configuration.configuration_id = definition.bundle_definition_id;
  configuration.configuration_version = 1;
  configuration.status = "draft";
  configuration.revision = { ...configuration.revision, draft_revision: 1, published_revision: 1 };
  const revision = parseBundleRevision({
    schema_version: "bundle_revision.v1", revision_id: "77770000-0000-4000-8000-000000000002", bundle_definition_id: definition.bundle_definition_id,
    revision_number: 1, status: "draft", configuration, runtime_snapshot_ref: null,
    created_at: "2026-07-21T00:00:00.000Z", updated_at: "2026-07-21T00:00:00.000Z", created_by: "test",
  });
  return { definition, revision, snapshot: compileRuntimeSnapshot(configuration), pilot_scope: {
    schema_version: "prebuilt_bundle_pilot_scope.v1", pilot_scope_id: "77770000-0000-4000-8000-000000000003",
    store_domain: "huang-mvqquz1p.myshopify.com", approved_product_series_keys: ["test"],
    approved_parent_variant_gids: [definition.parent_binding.variant_gid],
  } };
}

describe("pre-built Projection publication evidence", () => {
  it("binds one draft to its exact compiled Projection", () => {
    const value = fixture();
    const result = buildPrebuiltProjectionPublicationEvidence(value);
    expect(result.evidence.projection_checksum).toBe(result.projection.checksum);
    expect(result.evidence.components).toHaveLength(3);
    expect(assertPrebuiltProjectionPublicationEvidence(result.evidence, { ...value, projection: result.projection })).toBe(true);
  });

  it("rejects altered component prices", () => {
    const value = fixture();
    const result = buildPrebuiltProjectionPublicationEvidence(value);
    const tampered = { ...result.evidence, components: [{ ...result.evidence.components[0], fixed_price_per_unit: "0.01" }, ...result.evidence.components.slice(1)] };
    expect(() => assertPrebuiltProjectionPublicationEvidence(tampered, { ...value, projection: result.projection })).toThrow("components do not match");
  });

  it("supports a next immutable revision on an active definition", () => {
    const value = fixture();
    const publishedRevision = parseBundleRevision({
      ...value.revision,
      status: "published",
      runtime_snapshot_ref: {
        schema_version: value.snapshot.snapshot_schema,
        checksum_algorithm: value.snapshot.checksum_algorithm,
        checksum: value.snapshot.checksum,
        configuration_version: value.snapshot.configuration_version,
      },
    });
    const definition = parseBundleDefinition({
      ...value.definition,
      active_revision_id: publishedRevision.revision_id,
    });
    const draft = createNextDraftRevision({
      publishedRevision,
      revisionId: "77770000-0000-4000-8000-000000000099",
      createdAt: "2026-07-21T08:00:00Z",
      createdBy: "test",
    });
    const snapshot = compileRuntimeSnapshot(draft.configuration);

    const result = buildPrebuiltProjectionPublicationEvidence({
      definition,
      revision: draft,
      revisions: [publishedRevision, draft],
      snapshot,
      pilot_scope: value.pilot_scope,
    });

    expect(result.evidence.revision_id).toBe(draft.revision_id);
    expect(result.projection.published_revision_id).toBe(draft.revision_id);
  });
});
