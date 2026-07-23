import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "../extensions/master-kit-expand/src/config/fixtures/master-kit-config.v1.js";
import { PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-runtime.selection.js";
import { diagnosePrebuiltFunctionInput } from "./diagnose-prebuilt-function-input.js";

function readyInput() {
  const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
  const mapping = {
    schema_version: PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION,
    parent_variant_gid: snapshot.parent.variant_gid,
    bundle_definition_id: snapshot.configuration_id,
    published_revision_id: "77770000-0000-4000-8000-000000000001",
    status: "published",
    pilot_scope_approved: true,
    snapshot_checksum: snapshot.checksum,
    fixed_selections: Object.fromEntries(
      snapshot.groups.map((group) => [group.key, group.default_option]),
    ),
  };

  return {
    cart: {
      lines: [{
        id: "gid://shopify/CartLine/prebuilt",
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
      }],
    },
  };
}

describe("pre-built hosted RunInput diagnostic summary", () => {
  it("reports a ready candidate without printing raw mapping or Snapshot documents", () => {
    const result = diagnosePrebuiltFunctionInput(readyInput());

    expect(result).toMatchObject({
      status: "ready",
      prepared_candidate_count: 1,
      operation_count: 1,
      operations: [{
        cart_line_id: "gid://shopify/CartLine/prebuilt",
        component_count: 3,
        component_variant_gids: [
          "gid://shopify/ProductVariant/51592538587414",
          "gid://shopify/ProductVariant/51505348346134",
          "gid://shopify/ProductVariant/51592730706198",
        ],
        allocated_total: "750.48",
      }],
    });
    expect(JSON.stringify(result)).not.toContain("fixed_selections");
    expect(JSON.stringify(result)).not.toContain("snapshot_checksum");
  });

  it("reports the exact fail-closed layer for incomplete input", () => {
    const input = readyInput();
    input.cart.lines[0].merchandise.product.prebuiltRuntimeSnapshotMetafield = null;

    const result = diagnosePrebuiltFunctionInput(input);

    expect(result.operation_count).toBe(0);
    expect(result.input_observations[0]).toMatchObject({
      status: "rejected",
      reason: "SNAPSHOT_METAFIELD_INVALID",
    });
  });
});
