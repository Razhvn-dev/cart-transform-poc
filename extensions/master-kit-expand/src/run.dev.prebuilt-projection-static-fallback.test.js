import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./config/bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./config/fixtures/master-kit-config.v1.js";
import { compilePrebuiltBundleExpandProjection } from "./config/prebuilt-bundle-expand-projection.js";
import { PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION, resolvePrebuiltBundleSelection } from "./config/prebuilt-bundle-runtime.selection.js";
import { run } from "./run.dev.prebuilt-projection-static-fallback.js";

const STATIC_PARENT_VARIANT = "gid://shopify/ProductVariant/51571819708694";
const STATIC_PARENT_PRODUCT = "gid://shopify/Product/10627515777302";

function projectionLine() {
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
  const resolved = resolvePrebuiltBundleSelection({
    parent_variant_gid: snapshot.parent.variant_gid,
    mapping,
    snapshot,
  });
  const projection = compilePrebuiltBundleExpandProjection({
    mapping,
    resolved_candidate: resolved.resolved,
  }).projection;
  return {
    id: "gid://shopify/CartLine/projection",
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
        prebuiltExpandProjectionMetafield: { jsonValue: projection },
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
      product: { id: STATIC_PARENT_PRODUCT, prebuiltExpandProjectionMetafield: null },
    },
  };
}

describe("dev-only pre-built Projection with static fallback", () => {
  it("expands a server-published Projection and retains the proven static regression probe", () => {
    const result = run({ cart: { lines: [projectionLine(), staticProbeLine()] } });

    expect(result.operations.map((operation) => operation.expand.cartLineId)).toEqual([
      "gid://shopify/CartLine/projection",
      "gid://shopify/CartLine/static-probe",
    ]);
    expect(result.operations[0].expand.expandedCartItems).toHaveLength(3);
    expect(result.operations[1].expand.expandedCartItems).toHaveLength(3);
  });
});
