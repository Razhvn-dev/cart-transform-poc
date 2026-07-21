import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./config/bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./config/fixtures/master-kit-config.v1.js";
import { PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION } from "./config/prebuilt-bundle-runtime.selection.js";
import { run } from "./run.dev.prebuilt-candidate-static-fallback.js";

const STATIC_PARENT_VARIANT = "gid://shopify/ProductVariant/51571819708694";
const STATIC_PARENT_PRODUCT = "gid://shopify/Product/10627515777302";

function candidateLine() {
  const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
  const mapping = {
    schema_version: PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION,
    parent_variant_gid: snapshot.parent.variant_gid,
    bundle_definition_id: snapshot.configuration_id,
    published_revision_id: "77770000-0000-4000-8000-000000000001",
    status: "published",
    pilot_scope_approved: true,
    snapshot_checksum: snapshot.checksum,
    fixed_selections: Object.fromEntries(snapshot.groups.map((group) => [group.key, group.default_option])),
  };
  return {
    id: "gid://shopify/CartLine/candidate",
    quantity: 1,
    bundleId: { value: "906ec234-e2b5-4bc9-a13f-a2dfedfa7694" },
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
        prebuiltRuntimeMappingMetafield: { jsonValue: mapping },
        prebuiltRuntimeSnapshotMetafield: { jsonValue: snapshot },
      },
    },
  };
}

function staticProbeLine() {
  return {
    id: "gid://shopify/CartLine/static-probe",
    quantity: 1,
    merchandise: {
      __typename: "ProductVariant",
      id: STATIC_PARENT_VARIANT,
      product: {
        id: STATIC_PARENT_PRODUCT,
        prebuiltRuntimeMappingMetafield: null,
        prebuiltRuntimeSnapshotMetafield: null,
      },
    },
  };
}

describe("dev-only pre-built candidate with static fallback", () => {
  it("keeps the proven static probe while a separate complete candidate expands", () => {
    const result = run({ cart: { lines: [candidateLine(), staticProbeLine()] } });

    expect(result.operations.map((operation) => operation.expand.cartLineId)).toEqual([
      "gid://shopify/CartLine/candidate",
      "gid://shopify/CartLine/static-probe",
    ]);
    expect(result.operations[0].expand.expandedCartItems).toHaveLength(3);
    expect(result.operations[1].expand.expandedCartItems).toHaveLength(3);
  });

  it("does not duplicate a static parent when it is itself covered by a complete candidate", () => {
    const candidate = candidateLine();
    candidate.id = "gid://shopify/CartLine/static-candidate";
    candidate.merchandise.id = STATIC_PARENT_VARIANT;
    candidate.merchandise.product.id = STATIC_PARENT_PRODUCT;
    candidate.parentProductGid.value = STATIC_PARENT_PRODUCT;
    candidate.parentVariantGid.value = STATIC_PARENT_VARIANT;
    candidate.merchandise.product.prebuiltRuntimeMappingMetafield.jsonValue.parent_variant_gid = STATIC_PARENT_VARIANT;
    candidate.merchandise.product.prebuiltRuntimeSnapshotMetafield.jsonValue.parent.product_gid = STATIC_PARENT_PRODUCT;
    candidate.merchandise.product.prebuiltRuntimeSnapshotMetafield.jsonValue.parent.variant_gid = STATIC_PARENT_VARIANT;

    const result = run({ cart: { lines: [candidate] } });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].expand.cartLineId).toBe("gid://shopify/CartLine/static-candidate");
  });
});
