import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { compilePrebuiltBundleExpandProjection } from "./prebuilt-bundle-expand-projection.js";
import { buildPrebuiltBundleProjectionFunctionCandidate } from "./prebuilt-bundle-projection.function-candidate.js";
import { PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION, resolvePrebuiltBundleSelection } from "./prebuilt-bundle-runtime.selection.js";
import { run as runProjectionCandidate } from "../run.dev.prebuilt-projection-candidate.js";

function fixture() {
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
    parent_variant_gid: mapping.parent_variant_gid,
    mapping,
    snapshot,
  });
  return {
    snapshot,
    projection: compilePrebuiltBundleExpandProjection({ mapping, resolved_candidate: resolved.resolved }).projection,
  };
}

function line({ id = "gid://shopify/CartLine/prebuilt", bundleId = "906ec234-e2b5-4bc9-a13f-a2dfedfa7694", projection = fixture().projection } = {}) {
  const { snapshot } = fixture();
  return {
    id,
    quantity: 1,
    cost: { amountPerQuantity: { amount: projectionTotal(projection) } },
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
        prebuiltExpandProjectionMetafield: { jsonValue: projection },
      },
    },
  };
}

function projectionTotal(projection) {
  const cents = projection.components.reduce(
    (total, component) => total + Math.round(Number(component.fixed_price_per_unit) * 100),
    0,
  );
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

describe("pre-built projection Function candidate", () => {
  it("emits the compact projection with Metadata V1 and fixed prices", () => {
    const candidate = buildPrebuiltBundleProjectionFunctionCandidate({ cart: { lines: [line()] } });

    expect(candidate).toMatchObject({
      status: "ready",
      valid_metadata_count: 1,
      prepared_candidate_count: 1,
      operation_shape_issues: [],
    });
    const operation = candidate.result.operations[0].expand;
    expect(operation.expandedCartItems).toHaveLength(3);
    expect(operation.expandedCartItems.map((item) => item.price.adjustment.fixedPricePerUnit.amount))
      .toEqual(["512.99", "190.00", "47.49"]);
    expect(Object.fromEntries(operation.expandedCartItems[0].attributes.map(({ key, value }) => [key, value])))
      .toMatchObject({
        _bundle_id: "906ec234-e2b5-4bc9-a13f-a2dfedfa7694",
        _bundle_schema_version: "1",
        _component_group: "efi_system",
        _component_sequence: "1",
      });
  });

  it("fails closed for a tampered projection or parent mismatch", () => {
    const projection = fixture().projection;
    const tampered = {
      ...projection,
      components: projection.components.map((component, index) => index === 0
        ? { ...component, fixed_price_per_unit: "1.00" }
        : component),
    };
    const mismatched = line();
    mismatched.merchandise.id = "gid://shopify/ProductVariant/999";

    expect(buildPrebuiltBundleProjectionFunctionCandidate({ cart: { lines: [line({ projection: tampered })] } }).result)
      .toEqual({ operations: [] });
    expect(buildPrebuiltBundleProjectionFunctionCandidate({ cart: { lines: [mismatched] } }).result)
      .toEqual({ operations: [] });
  });

  it("rejects duplicate bundle instance IDs atomically", () => {
    const lines = [line(), line({ id: "gid://shopify/CartLine/prebuilt-2" })];
    const candidate = buildPrebuiltBundleProjectionFunctionCandidate({ cart: { lines } });

    expect(candidate.status).toBe("unavailable");
    expect(candidate.result).toEqual({ operations: [] });
  });

  it("fails closed when component prices do not preserve the parent line price", () => {
    const mismatchedPrice = line();
    mismatchedPrice.cost.amountPerQuantity.amount = "1.00";

    expect(buildPrebuiltBundleProjectionFunctionCandidate({ cart: { lines: [mismatchedPrice] } }))
      .toMatchObject({ status: "unavailable", result: { operations: [] } });
  });

  it("keeps the hard-coded Builder path and projection path independent", () => {
    const builder = {
      id: "gid://shopify/CartLine/builder",
      quantity: 1,
      merchandise: {
        __typename: "ProductVariant",
        id: "gid://shopify/ProductVariant/51505325605142",
        product: { id: "gid://shopify/Product/10600519598358" },
      },
    };
    const result = runProjectionCandidate({ cart: { lines: [builder, line()] } });

    expect(result.operations.map((operation) => operation.expand.cartLineId)).toEqual([
      "gid://shopify/CartLine/builder",
      "gid://shopify/CartLine/prebuilt",
    ]);
    expect(result.operations.map((operation) => operation.expand.expandedCartItems.length)).toEqual([3, 3]);
  });
});
