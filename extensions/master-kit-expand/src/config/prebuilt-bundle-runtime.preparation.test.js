import { describe, expect, it } from "vitest";

import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION } from "./prebuilt-bundle-runtime.selection.js";
import { preparePrebuiltBundleRuntimeSelections } from "./prebuilt-bundle-runtime.preparation.js";

const REVISION_ID = "77770000-0000-4000-8000-000000000001";

function line(id, variantId) {
  return {
    id,
    merchandise: { __typename: "ProductVariant", id: variantId },
    builderEfiVariantId: { value: "client-supplied-and-ignored" },
  };
}

function mappingFor(snapshot) {
  return {
    schema_version: PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION,
    parent_variant_gid: snapshot.parent.variant_gid,
    bundle_definition_id: snapshot.configuration_id,
    published_revision_id: REVISION_ID,
    status: "published",
    pilot_scope_approved: true,
    snapshot_checksum: snapshot.checksum,
    fixed_selections: Object.fromEntries(snapshot.groups.map((group) => [group.key, group.default_option])),
  };
}

describe("pre-built Bundle runtime preparation", () => {
  it("prepares each authorized cart line independently and ignores unrelated lines", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const mapping = mappingFor(snapshot);
    const lines = [
      line("gid://shopify/CartLine/1", snapshot.parent.variant_gid),
      line("gid://shopify/CartLine/2", "gid://shopify/ProductVariant/999"),
      line("gid://shopify/CartLine/3", snapshot.parent.variant_gid),
    ];

    const prepared = preparePrebuiltBundleRuntimeSelections(lines, {
      lookupMapping: (variantId) => variantId === snapshot.parent.variant_gid ? mapping : null,
      lookupSnapshot: () => snapshot,
    });

    expect(prepared.map((item) => item.cart_line_id)).toEqual([
      "gid://shopify/CartLine/1",
      "gid://shopify/CartLine/3",
    ]);
    expect(prepared[0]).not.toBe(prepared[1]);
    expect(prepared[0].resolved_candidate.components).toHaveLength(3);
    expect(Object.isFrozen(prepared[0])).toBe(true);
  });

  it("fails closed when server lookup throws or returns an invalid mapping", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const lines = [line("gid://shopify/CartLine/1", snapshot.parent.variant_gid)];

    expect(preparePrebuiltBundleRuntimeSelections(lines, {
      lookupMapping: () => { throw new Error("source unavailable"); },
    })).toEqual([]);
    expect(preparePrebuiltBundleRuntimeSelections(lines, {
      lookupMapping: () => ({ status: "draft" }),
      lookupSnapshot: () => snapshot,
    })).toEqual([]);
  });
});
