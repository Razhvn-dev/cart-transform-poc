import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./config/bundle-runtime.compiler.js";
import { calculateStableValueChecksum } from "./config/bundle-runtime.checksum.js";
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
    cost: {
      amountPerQuantity: {
        amount: projection.components.reduce(
          (total, component) => (Number(total) + Number(component.fixed_price_per_unit)).toFixed(2),
          "0.00",
        ),
      },
    },
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

function realProjectionLineWithMismatchedTotal() {
  const projectionBody = {
    schema_version: "prebuilt_bundle_expand_projection.v1",
    checksum_algorithm: "fnv1a-32",
    bundle_definition_id: "4b5c384b-acc6-455d-b14a-7a1e6d433ffc",
    published_revision_id: "e94be6f4-e08d-483b-9dcc-d80b98ee4246",
    source_snapshot_checksum: "637f5b3f",
    parent: {
      product_gid: "gid://shopify/Product/10638462877974",
      variant_gid: "gid://shopify/ProductVariant/51592671789334",
      sku: "AF4005PK",
      title: "255 In-line Fuel Pump System with PTFE Hose + Pressure Sensor Kit",
    },
    components: [
      {
        sequence: 1, group: "fuel_system", role: "fuel_delivery",
        product_gid: "gid://shopify/Product/10638462877974",
        variant_gid: "gid://shopify/ProductVariant/51592671756566",
        sku: "AF4005P", title: "255 In-line Fuel Pump System with PTFE Hose",
        fixed_price_per_unit: "469.99",
      },
      {
        sequence: 2, group: "pressure_sensor", role: "pressure_sensor",
        product_gid: "gid://shopify/Product/10638465335574",
        variant_gid: "gid://shopify/ProductVariant/51592717566230",
        sku: "AF2009P", title: "Pressure Sensor Kit",
        fixed_price_per_unit: "119.99",
      },
    ],
  };
  const projection = { ...projectionBody, checksum: calculateStableValueChecksum(projectionBody) };
  return {
    id: "gid://shopify/CartLine/real-af4005pk",
    quantity: 1,
    cost: { amountPerQuantity: { amount: "559.99" } },
    bundleId: { value: "6cfc2e72-6ae5-4541-b71f-aac2052f9f54" },
    bundleSchemaVersion: { value: "1" },
    parentProductGid: { value: projection.parent.product_gid },
    parentVariantGid: { value: projection.parent.variant_gid },
    parentSku: { value: projection.parent.sku },
    parentTitle: { value: projection.parent.title },
    merchandise: {
      __typename: "ProductVariant",
      id: projection.parent.variant_gid,
      product: {
        id: projection.parent.product_gid,
        prebuiltExpandProjectionMetafield: { jsonValue: projection },
      },
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

  it("fails closed when a published Projection does not preserve the live parent price", () => {
    const line = realProjectionLineWithMismatchedTotal();
    const result = run({ cart: { lines: [line] } });

    expect(result.operations).toEqual([]);
  });
});
