import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { buildPrebuiltBundleRuntimeCatalog } from "./prebuilt-bundle-runtime.catalog.js";
import { buildPrebuiltBundleRuntimeLocalCandidate } from "./prebuilt-bundle-runtime.local-candidate.js";
import { PREBUILT_BUNDLE_RUNTIME_ASSIGNMENT_SCHEMA_VERSION } from "./prebuilt-bundle-runtime.assignment.js";

const DEFINITION_ID = "77770000-0000-4000-8000-000000000030";
const REVISION_ID = "77770000-0000-4000-8000-000000000031";
const AT = "2026-07-17T00:00:00Z";

function fixture({ fixedSelections } = {}) {
  const configuration = structuredClone(masterKitConfigV1);
  configuration.configuration_id = DEFINITION_ID;
  configuration.configuration_version = 1;
  configuration.status = "active";
  configuration.revision = { draft_revision: 1, published_revision: 1 };
  const snapshot = compileRuntimeSnapshot(configuration);
  const definition = {
    schema_version: "bundle_definition.v1", bundle_definition_id: DEFINITION_ID, slug: "prebuilt-standard",
    parent_binding: { product_gid: snapshot.parent.product_gid, variant_gid: snapshot.parent.variant_gid },
    active_revision_id: REVISION_ID, created_at: AT, updated_at: AT,
  };
  const revision = {
    schema_version: "bundle_revision.v1", revision_id: REVISION_ID, bundle_definition_id: DEFINITION_ID,
    revision_number: 1, status: "published", configuration,
    runtime_snapshot_ref: { schema_version: snapshot.snapshot_schema, checksum_algorithm: "fnv1a-32", checksum: snapshot.checksum, configuration_version: 1 },
    created_at: AT, updated_at: AT, created_by: "test",
  };
  const selections = fixedSelections ?? Object.fromEntries(
    snapshot.groups.map((group) => [group.key, group.default_option]),
  );
  const catalog = buildPrebuiltBundleRuntimeCatalog({
    definitions: [definition], revisions: [revision],
    snapshots_by_definition_id: { [DEFINITION_ID]: snapshot },
    assignments: [{
        schema_version: PREBUILT_BUNDLE_RUNTIME_ASSIGNMENT_SCHEMA_VERSION,
        target_fingerprint: "5678abcd",
        source_identity: "legacy:standard",
        source_fingerprint: "1234abcd",
        bundle_definition_id: DEFINITION_ID,
        parent_variant_gid: snapshot.parent.variant_gid,
        fixed_selections: selections,
        pilot_scope_id: "77770000-0000-4000-8000-000000000032",
      }],
    pilot_scope: {
      schema_version: "prebuilt_bundle_pilot_scope.v1",
      pilot_scope_id: "77770000-0000-4000-8000-000000000032",
      store_domain: "huang-mvqquz1p.myshopify.com",
      approved_product_series_keys: ["master-kit"],
      approved_parent_variant_gids: [snapshot.parent.variant_gid],
    },
  });
  return { snapshot, catalog };
}

describe("pre-built Bundle local candidate flow", () => {
  it("builds fresh operations only for catalog-authorized pre-built parent lines", () => {
    const { snapshot, catalog } = fixture();
    const candidate = buildPrebuiltBundleRuntimeLocalCandidate({
      cart_lines: [
        prebuiltLine("gid://shopify/CartLine/1", snapshot),
        { id: "gid://shopify/CartLine/2", merchandise: { __typename: "ProductVariant", id: "gid://shopify/ProductVariant/999" } },
      ],
      catalog,
      snapshots_by_definition_id: { [snapshot.configuration_id]: snapshot },
    });

    expect(candidate.prepared_candidates).toHaveLength(1);
    expect(candidate.metadata_observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cart_line_id: "gid://shopify/CartLine/1",
        observation: expect.objectContaining({ status: "valid" }),
      }),
      expect.objectContaining({
        cart_line_id: "gid://shopify/CartLine/2",
        observation: expect.objectContaining({ status: "missing" }),
      }),
    ]));
    expect(candidate).toMatchObject({ status: "ready", operation_shape_issues: [] });
    expect(candidate.result.operations).toHaveLength(1);
    expect(candidate.result.operations[0].expand).toMatchObject({ cartLineId: "gid://shopify/CartLine/1" });
    expect(candidate.result.operations[0].expand.expandedCartItems.map((item) => item.merchandiseId)).toEqual([
      "gid://shopify/ProductVariant/51592538587414",
      "gid://shopify/ProductVariant/51505348346134",
      "gid://shopify/ProductVariant/51592730706198",
    ]);
    expect(JSON.stringify(candidate.result)).not.toContain("ignored");
  });

  it("requires valid Metadata V1 before an approved Advanced SKU can produce all fixed components", () => {
    const { snapshot, catalog } = fixture({
      fixedSelections: {
        efi_system: "efi_killshot_2_pro",
        fuel_system: "fuel_test_2",
        ignition: "ignition_high_roller_cdi",
        display: "display_8_hd_handheld",
      },
    });
    const candidate = buildPrebuiltBundleRuntimeLocalCandidate({
      cart_lines: [prebuiltLine("gid://shopify/CartLine/advanced", snapshot, "8cb17f0a-51ce-4397-9a26-cf075c2ab5c3")],
      catalog,
      snapshots_by_definition_id: { [snapshot.configuration_id]: snapshot },
    });

    expect(candidate.metadata_observations[0].observation.status).toBe("valid");
    expect(candidate).toMatchObject({ status: "ready", operation_shape_issues: [] });
    expect(candidate.result.operations[0].expand.expandedCartItems.map((item) => item.merchandiseId)).toEqual([
      "gid://shopify/ProductVariant/51552319865110",
      "gid://shopify/ProductVariant/51518319591702",
      "gid://shopify/ProductVariant/51552321110294",
      "gid://shopify/ProductVariant/51552322584854",
    ]);
  });

  it("fails closed without a catalog or matching Snapshot and returns a new immutable result", () => {
    const { snapshot, catalog } = fixture();
    const input = { cart_lines: [prebuiltLine("gid://shopify/CartLine/1", snapshot)], catalog };
    const missingSnapshot = buildPrebuiltBundleRuntimeLocalCandidate(input);
    expect(missingSnapshot).toMatchObject({ status: "ready", prepared_candidates: [], result: { operations: [] }, operation_shape_issues: [] });

    const valid = buildPrebuiltBundleRuntimeLocalCandidate({ ...input, snapshots_by_definition_id: { [snapshot.configuration_id]: snapshot } });
    snapshot.groups[0].options[0].label = "mutated later";
    expect(valid.prepared_candidates[0].resolved_candidate.components[0].title).not.toBe("mutated later");
    expect(valid.operation_shape_issues).toEqual([]);
    expect(Object.isFrozen(valid)).toBe(true);
  });

  it("does not prepare a mapped parent when its client metadata is absent, stale, or non-single", () => {
    const { snapshot, catalog } = fixture();
    const baseline = prebuiltLine("gid://shopify/CartLine/1", snapshot);
    const candidate = buildPrebuiltBundleRuntimeLocalCandidate({
      cart_lines: [
        { ...baseline, bundleId: null },
        { ...baseline, id: "gid://shopify/CartLine/2", parentVariantGid: { value: "gid://shopify/ProductVariant/999" } },
        { ...baseline, id: "gid://shopify/CartLine/3", quantity: 2 },
      ],
      catalog,
      snapshots_by_definition_id: { [snapshot.configuration_id]: snapshot },
    });

    expect(candidate.prepared_candidates).toEqual([]);
    expect(candidate.result).toEqual({ operations: [] });
    expect(candidate.metadata_observations.map(({ observation }) => observation.reason)).toEqual([
      "BUNDLE_INSTANCE_ID_MISSING",
      "PARENT_VARIANT_MISMATCH",
      "BUNDLE_QUANTITY_NOT_SINGLE",
    ]);
  });

  it("fails closed for every Cart line that reuses a bundle instance ID", () => {
    const { snapshot, catalog } = fixture();
    const candidate = buildPrebuiltBundleRuntimeLocalCandidate({
      cart_lines: [
        prebuiltLine("gid://shopify/CartLine/1", snapshot),
        prebuiltLine("gid://shopify/CartLine/2", snapshot),
      ],
      catalog,
      snapshots_by_definition_id: { [snapshot.configuration_id]: snapshot },
    });

    expect(candidate.prepared_candidates).toEqual([]);
    expect(candidate.result).toEqual({ operations: [] });
    expect(candidate.metadata_observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cart_line_id: "gid://shopify/CartLine/1",
        observation: { status: "invalid", reason: "BUNDLE_INSTANCE_ID_DUPLICATE", metadata: null },
      }),
      expect.objectContaining({
        cart_line_id: "gid://shopify/CartLine/2",
        observation: { status: "invalid", reason: "BUNDLE_INSTANCE_ID_DUPLICATE", metadata: null },
      }),
    ]));
  });
});

function prebuiltLine(id, snapshot, bundleInstanceId = "4af6d8b0-0427-49a1-8be7-270bb4132514") {
  return {
    id,
    quantity: 1,
    bundleId: { value: bundleInstanceId },
    bundleSchemaVersion: { value: "1" },
    parentProductGid: { value: snapshot.parent.product_gid },
    parentVariantGid: { value: snapshot.parent.variant_gid },
    parentSku: { value: "MASTER-KIT-001" },
    parentTitle: { value: "Master Kit Test" },
    merchandise: {
      __typename: "ProductVariant",
      id: snapshot.parent.variant_gid,
      product: { id: snapshot.parent.product_gid },
    },
  };
}
