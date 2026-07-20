import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION } from "./prebuilt-bundle-runtime.selection.js";
import { buildPrebuiltBundleRuntimeFunctionCandidate } from "./prebuilt-bundle-runtime.function-candidate.js";
import { run as runPrebuiltCandidate } from "../run.dev.prebuilt-candidate.js";

function fixture() {
  const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
  return {
    snapshot,
    mapping: {
      schema_version: PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION,
      parent_variant_gid: snapshot.parent.variant_gid,
      bundle_definition_id: snapshot.configuration_id,
      published_revision_id: "77770000-0000-4000-8000-000000000001",
      status: "published",
      pilot_scope_approved: true,
      snapshot_checksum: snapshot.checksum,
      fixed_selections: {
        efi_system: "efi_killshot_2_pro",
        fuel_system: "fuel_test_2",
        ignition: "ignition_high_roller_cdi",
        display: "display_8_hd_handheld",
      },
    },
  };
}

function input({
  bundleId = "906ec234-e2b5-4bc9-a13f-a2dfedfa7694",
  mapping: mappingOverride,
  snapshot: snapshotOverride,
  fixtureData = fixture(),
} = {}) {
  const { mapping, snapshot } = fixtureData;
  const resolvedMapping = mappingOverride ?? mapping;
  const resolvedSnapshot = snapshotOverride ?? snapshot;
  return {
    cart: {
      lines: [{
        id: "gid://shopify/CartLine/prebuilt",
        quantity: 1,
        bundleId: { value: bundleId },
        bundleSchemaVersion: { value: "1" },
        parentProductGid: { value: snapshot.parent.product_gid },
        parentVariantGid: { value: snapshot.parent.variant_gid },
        parentSku: { value: snapshot.parent.sku },
        parentTitle: { value: snapshot.parent.title },
        merchandise: {
          __typename: "ProductVariant",
          id: snapshot.parent.variant_gid,
          product: {
            id: snapshot.parent.product_gid,
            prebuiltRuntimeMappingMetafield: { jsonValue: resolvedMapping },
            prebuiltRuntimeSnapshotMetafield: { jsonValue: resolvedSnapshot },
          },
        },
      }],
    },
  };
}

describe("pre-built Bundle future Function candidate composition", () => {
  it("keeps Node-only structuredClone out of the hosted Function candidate graph", () => {
    const configDirectory = dirname(fileURLToPath(import.meta.url));
    [
      "prebuilt-bundle-runtime.function-input.js",
      "prebuilt-bundle-runtime.local-candidate.js",
      "prebuilt-bundle-runtime.function-candidate.js",
      "prebuilt-bundle-runtime.candidate-promotion.js",
      "prebuilt-bundle-runtime.clone.js",
      "prebuilt-bundle-runtime.catalog-lookup.js",
      "prebuilt-bundle-runtime.selection.js",
    ].forEach((filename) => {
      expect(readFileSync(resolve(configDirectory, filename), "utf8")).not.toContain("structuredClone(");
    });
  });

  it("keeps catalog compilation dependencies out of the hosted candidate entry", () => {
    const configDirectory = dirname(fileURLToPath(import.meta.url));
    const candidateSource = readFileSync(resolve(configDirectory, "prebuilt-bundle-runtime.function-candidate.js"), "utf8");
    const localCandidateSource = readFileSync(resolve(configDirectory, "prebuilt-bundle-runtime.local-candidate.js"), "utf8");

    expect(candidateSource).not.toContain("prebuilt-bundle-runtime.catalog.js");
    expect(localCandidateSource).not.toContain("prebuilt-bundle-runtime.catalog.js");
  });

  it("builds a fresh Advanced expand result only from matching server metafields and Metadata V1", () => {
    const candidate = buildPrebuiltBundleRuntimeFunctionCandidate(input());

    expect(candidate).toMatchObject({ status: "ready", operation_shape_issues: [] });
    expect(candidate).toMatchObject({
      valid_metadata_count: 1,
      prepared_candidate_count: 1,
    });
    expect(candidate).not.toHaveProperty("input_observations");
    expect(candidate).not.toHaveProperty("metadata_observations");
    expect(candidate).not.toHaveProperty("prepared_candidates");
    expect(candidate.result.operations[0].expand.expandedCartItems.map((item) => item.merchandiseId)).toEqual([
      "gid://shopify/ProductVariant/51552319865110",
      "gid://shopify/ProductVariant/51518319591702",
      "gid://shopify/ProductVariant/51552321110294",
      "gid://shopify/ProductVariant/51552322584854",
    ]);
    expect(Object.fromEntries(
      candidate.result.operations[0].expand.expandedCartItems[0].attributes.map(
        ({ key, value }) => [key, value],
      ),
    )).toMatchObject({
      _bundle_id: "906ec234-e2b5-4bc9-a13f-a2dfedfa7694",
      _bundle_schema_version: "1",
      _parent_product_gid: snapshotParent().product_gid,
      _parent_variant_gid: snapshotParent().variant_gid,
      _component_group: "efi_system",
      _component_role: "efi",
      _component_variant_gid: "gid://shopify/ProductVariant/51552319865110",
      _component_sequence: "1",
    });
    expect(Object.isFrozen(candidate)).toBe(true);
  });

  it("accepts the representative prebuilt-bundle-test parent identity instead of relying on the legacy Builder parent", () => {
    const configuration = structuredClone(masterKitConfigV1);
    configuration.configuration_id = "4b8d6e5a-6c68-4d78-8e5b-1a9b8e5f1001";
    configuration.slug = "prebuilt-bundle-test";
    configuration.parent = {
      ...configuration.parent,
      product_gid: "gid://shopify/Product/10627515777302",
      variant_gid: "gid://shopify/ProductVariant/51571819708694",
      sku: "PREBUILT-BUNDLE-TEST",
      title: "Prebuilt Bundle Test",
      template_handle: "prebuilt-bundle-test",
    };
    const snapshot = compileRuntimeSnapshot(configuration);
    const mapping = {
      schema_version: PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION,
      parent_variant_gid: snapshot.parent.variant_gid,
      bundle_definition_id: snapshot.configuration_id,
      published_revision_id: "4b8d6e5a-6c68-4d78-8e5b-1a9b8e5f1002",
      status: "published",
      pilot_scope_approved: true,
      snapshot_checksum: snapshot.checksum,
      fixed_selections: Object.fromEntries(
        snapshot.groups.map((group) => [group.key, group.default_option]),
      ),
    };

    const result = runPrebuiltCandidate(input({ fixtureData: { mapping, snapshot } }));

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].expand.cartLineId).toBe("gid://shopify/CartLine/prebuilt");
    expect(result.operations[0].expand.expandedCartItems).toHaveLength(3);
    expect(Object.fromEntries(
      result.operations[0].expand.expandedCartItems[0].attributes.map(
        ({ key, value }) => [key, value],
      ),
    )).toMatchObject({
      _parent_product_gid: "gid://shopify/Product/10627515777302",
      _parent_variant_gid: "gid://shopify/ProductVariant/51571819708694",
      _parent_sku: "PREBUILT-BUNDLE-TEST",
      _parent_title: "Prebuilt Bundle Test",
    });
  });

  it("fails closed before component resolution for missing metadata or mismatched server Snapshot data", () => {
    const metadataMissing = buildPrebuiltBundleRuntimeFunctionCandidate(input({ bundleId: null }));
    const { mapping, snapshot } = fixture();
    const snapshotMismatch = buildPrebuiltBundleRuntimeFunctionCandidate(input({
      mapping,
      snapshot: { ...snapshot, checksum: "stale" },
    }));

    expect(metadataMissing.result).toEqual({ operations: [] });
    expect(metadataMissing.valid_metadata_count).toBe(0);
    expect(snapshotMismatch.result).toEqual({ operations: [] });
    expect(snapshotMismatch.prepared_candidate_count).toBe(0);
  });

  it("returns the pre-built expand only through the dev-only candidate profile", () => {
    const result = runPrebuiltCandidate(input());

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].expand.cartLineId).toBe("gid://shopify/CartLine/prebuilt");
    expect(result.operations[0].expand.expandedCartItems).toHaveLength(4);
  });

  it("keeps Builder and pre-built parent lines independent in a mixed cart", () => {
    const mixed = input();
    mixed.cart.lines.push({
      id: "gid://shopify/CartLine/builder",
      quantity: 1,
      builderEfiVariantId: { value: "gid://shopify/ProductVariant/51552319766806" },
      builderFuelVariantId: { value: "gid://shopify/ProductVariant/51505348346134" },
      builderIgnitionVariantId: { value: "gid://shopify/ProductVariant/51552321011990" },
      merchandise: {
        __typename: "ProductVariant",
        id: "gid://shopify/ProductVariant/51505325605142",
        product: { id: "gid://shopify/Product/10600519598358" },
      },
    });

    const result = runPrebuiltCandidate(mixed);

    expect(result.operations.map((operation) => operation.expand.cartLineId)).toEqual([
      "gid://shopify/CartLine/builder",
      "gid://shopify/CartLine/prebuilt",
    ]);
    expect(result.operations[0].expand.expandedCartItems).toHaveLength(3);
    expect(result.operations[1].expand.expandedCartItems).toHaveLength(4);
  });
});

function snapshotParent() {
  return fixture().snapshot.parent;
}
