import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import {
  buildPrebuiltBundleRuntimeCatalog,
  findPrebuiltBundleRuntimeMapping,
} from "./prebuilt-bundle-runtime.catalog.js";
import { PREBUILT_BUNDLE_RUNTIME_ASSIGNMENT_SCHEMA_VERSION } from "./prebuilt-bundle-runtime.assignment.js";

const FIRST_ID = "77770000-0000-4000-8000-000000000020";
const FIRST_REVISION = "77770000-0000-4000-8000-000000000021";
const SECOND_ID = "77770000-0000-4000-8000-000000000022";
const SECOND_REVISION = "77770000-0000-4000-8000-000000000023";
const AT = "2026-07-17T00:00:00Z";

function publishedBundle({ definitionId, revisionId, productId, variantId, slug }) {
  const configuration = structuredClone(masterKitConfigV1);
  configuration.configuration_id = definitionId;
  configuration.slug = slug;
  configuration.configuration_version = 1;
  configuration.status = "active";
  configuration.revision = { draft_revision: 1, published_revision: 1 };
  configuration.parent.product_gid = `gid://shopify/Product/${productId}`;
  configuration.parent.variant_gid = `gid://shopify/ProductVariant/${variantId}`;
  const snapshot = compileRuntimeSnapshot(configuration);
  return {
    definition: {
      schema_version: "bundle_definition.v1",
      bundle_definition_id: definitionId,
      slug,
      parent_binding: { product_gid: snapshot.parent.product_gid, variant_gid: snapshot.parent.variant_gid },
      active_revision_id: revisionId,
      created_at: AT,
      updated_at: AT,
    },
    revision: {
      schema_version: "bundle_revision.v1",
      revision_id: revisionId,
      bundle_definition_id: definitionId,
      revision_number: 1,
      status: "published",
      configuration,
      runtime_snapshot_ref: {
        schema_version: snapshot.snapshot_schema,
        checksum_algorithm: "fnv1a-32",
        checksum: snapshot.checksum,
        configuration_version: 1,
      },
      created_at: AT,
      updated_at: AT,
      created_by: "test",
    },
    snapshot,
    selections: Object.fromEntries(snapshot.groups.map((group) => [group.key, group.default_option])),
  };
}

function assignment(bundle, sourceIdentity) {
  return {
    schema_version: PREBUILT_BUNDLE_RUNTIME_ASSIGNMENT_SCHEMA_VERSION,
    source_identity: sourceIdentity,
    source_fingerprint: "1234abcd",
    target_fingerprint: "5678abcd",
    bundle_definition_id: bundle.definition.bundle_definition_id,
    parent_variant_gid: bundle.snapshot.parent.variant_gid,
    fixed_selections: bundle.selections,
    pilot_scope_id: "77770000-0000-4000-8000-000000000024",
  };
}

function pilotScope(variantGids) {
  return {
    schema_version: "prebuilt_bundle_pilot_scope.v1",
    pilot_scope_id: "77770000-0000-4000-8000-000000000025",
    store_domain: "huang-mvqquz1p.myshopify.com",
    approved_product_series_keys: ["master-kit"],
    approved_parent_variant_gids: variantGids,
  };
}

describe("pre-built Bundle runtime catalog", () => {
  it("indexes only explicitly approved, published parent Variants", () => {
    const first = publishedBundle({ definitionId: FIRST_ID, revisionId: FIRST_REVISION, productId: 100, variantId: 100, slug: "standard" });
    const second = publishedBundle({ definitionId: SECOND_ID, revisionId: SECOND_REVISION, productId: 200, variantId: 200, slug: "advanced" });
    const catalog = buildPrebuiltBundleRuntimeCatalog({
      definitions: [first.definition, second.definition],
      revisions: [first.revision, second.revision],
      snapshots_by_definition_id: { [FIRST_ID]: first.snapshot, [SECOND_ID]: second.snapshot },
      assignments: [assignment(first, "legacy:first"), assignment(second, "legacy:second")],
      pilot_scope: pilotScope([first.snapshot.parent.variant_gid]),
    });

    expect(catalog).toMatchObject({ status: "ready", entries: [expect.objectContaining({ bundle_definition_id: FIRST_ID })] });
    expect(catalog.expand_projections).toEqual([
      expect.objectContaining({
        bundle_definition_id: FIRST_ID,
        parent: expect.objectContaining({ variant_gid: first.snapshot.parent.variant_gid }),
      }),
    ]);
    expect(catalog.unavailable).toEqual([expect.objectContaining({ bundle_definition_id: SECOND_ID, reason: "PILOT_SCOPE_NOT_APPROVED" })]);
    expect(findPrebuiltBundleRuntimeMapping(catalog, first.snapshot.parent.variant_gid)).toMatchObject({ bundle_definition_id: FIRST_ID });
    expect(findPrebuiltBundleRuntimeMapping(catalog, second.snapshot.parent.variant_gid)).toBeNull();
  });

  it("does not expose a mutable catalog entry or accept an invalid domain", () => {
    const bundle = publishedBundle({ definitionId: FIRST_ID, revisionId: FIRST_REVISION, productId: 100, variantId: 100, slug: "standard" });
    const catalog = buildPrebuiltBundleRuntimeCatalog({
      definitions: [bundle.definition],
      revisions: [bundle.revision],
      snapshots_by_definition_id: { [FIRST_ID]: bundle.snapshot },
      assignments: [assignment(bundle, "legacy:first")],
      pilot_scope: pilotScope([bundle.snapshot.parent.variant_gid]),
    });
    const mapping = findPrebuiltBundleRuntimeMapping(catalog, bundle.snapshot.parent.variant_gid);
    mapping.fixed_selections.efi_system = "changed-locally";
    expect(findPrebuiltBundleRuntimeMapping(catalog, bundle.snapshot.parent.variant_gid).fixed_selections.efi_system)
      .toBe(bundle.selections.efi_system);

    expect(buildPrebuiltBundleRuntimeCatalog({ definitions: [bundle.definition], revisions: [] })).toMatchObject({
      status: "invalid",
      entries: [],
      expand_projections: [],
    });

    expect(buildPrebuiltBundleRuntimeCatalog({
      definitions: [bundle.definition],
      revisions: [bundle.revision],
      assignments: [assignment(bundle, "legacy:first"), assignment(bundle, "legacy:duplicate")],
      snapshots_by_definition_id: { [FIRST_ID]: bundle.snapshot },
      pilot_scope: pilotScope([bundle.snapshot.parent.variant_gid]),
    })).toMatchObject({ status: "invalid", entries: [] });
  });
});
