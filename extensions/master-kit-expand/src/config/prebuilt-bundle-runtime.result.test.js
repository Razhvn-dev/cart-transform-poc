import { describe, expect, it } from "vitest";

import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION } from "./prebuilt-bundle-runtime.selection.js";
import { preparePrebuiltBundleRuntimeSelections } from "./prebuilt-bundle-runtime.preparation.js";
import { buildPrebuiltBundleFunctionResult } from "./prebuilt-bundle-runtime.result.js";

function preparedCandidates() {
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
  return preparePrebuiltBundleRuntimeSelections([{
    id: "gid://shopify/CartLine/100",
    merchandise: { __typename: "ProductVariant", id: snapshot.parent.variant_gid },
  }], {
    lookupMapping: () => mapping,
    lookupSnapshot: () => snapshot,
  });
}

describe("pre-built Bundle Function result builder", () => {
  it("constructs a fresh supported expand result with fixed component prices", () => {
    const prepared = preparedCandidates();
    const result = buildPrebuiltBundleFunctionResult(prepared);

    expect(result).toEqual({
      operations: [{
        expand: {
          cartLineId: "gid://shopify/CartLine/100",
          title: "Master Kit Test",
          expandedCartItems: [
            expect.objectContaining({ merchandiseId: "gid://shopify/ProductVariant/51552319766806", quantity: 1 }),
            expect.objectContaining({ merchandiseId: "gid://shopify/ProductVariant/51505348346134", quantity: 1 }),
            expect.objectContaining({ merchandiseId: "gid://shopify/ProductVariant/51552321011990", quantity: 1 }),
          ],
        },
      }],
    });
    expect(result.operations[0].expand.expandedCartItems.map((item) => item.price.adjustment.fixedPricePerUnit.amount))
      .toEqual(["512.99", "190.00", "47.49"]);
    expect(result.operations[0].expand.expandedCartItems.every((item) => item.attributes === undefined)).toBe(true);
  });

  it("does not mutate prepared candidates and skips malformed candidates", () => {
    const prepared = preparedCandidates();
    const before = JSON.stringify(prepared);
    const result = buildPrebuiltBundleFunctionResult([
      ...prepared,
      { cart_line_id: "gid://shopify/CartLine/invalid", resolved_candidate: { parent: {}, components: [] } },
    ]);

    expect(JSON.stringify(prepared)).toBe(before);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).not.toBe(prepared[0]);
  });
});
