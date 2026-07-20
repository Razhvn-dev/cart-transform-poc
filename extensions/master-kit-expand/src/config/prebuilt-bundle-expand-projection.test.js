import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import {
  compilePrebuiltBundleExpandProjection,
  validatePrebuiltBundleExpandProjection,
} from "./prebuilt-bundle-expand-projection.js";
import {
  PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION,
  resolvePrebuiltBundleSelection,
} from "./prebuilt-bundle-runtime.selection.js";

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
  return { mapping, resolved_candidate: resolved.resolved };
}

describe("pre-built publication-time expand projection", () => {
  it("compiles a compact checksum-bound three-component projection", () => {
    const result = compilePrebuiltBundleExpandProjection(fixture());

    expect(result.status).toBe("ready");
    expect(result.projection.components.map((component) => component.variant_gid)).toEqual([
      "gid://shopify/ProductVariant/51552319766806",
      "gid://shopify/ProductVariant/51505348346134",
      "gid://shopify/ProductVariant/51552321011990",
    ]);
    expect(result.projection.components.map((component) => component.fixed_price_per_unit))
      .toEqual(["512.99", "190.00", "47.49"]);
    expect(validatePrebuiltBundleExpandProjection(result.projection)).toEqual([]);
    expect(JSON.stringify(result.projection)).not.toContain("fixed_selections");
    expect(JSON.stringify(result.projection)).not.toContain("groups");
  });

  it("rejects a tampered component price or parent Variant", () => {
    const { projection } = compilePrebuiltBundleExpandProjection(fixture());
    const tamperedPrice = {
      ...projection,
      components: projection.components.map((component, index) => (
        index === 0 ? { ...component, fixed_price_per_unit: "1.00" } : component
      )),
    };
    const tamperedParent = {
      ...projection,
      parent: { ...projection.parent, variant_gid: "gid://shopify/ProductVariant/999" },
    };

    expect(validatePrebuiltBundleExpandProjection(tamperedPrice)).toContain("projection checksum is invalid");
    expect(validatePrebuiltBundleExpandProjection(tamperedParent)).toContain("projection checksum is invalid");
  });

  it("fails closed for incomplete publication inputs", () => {
    expect(compilePrebuiltBundleExpandProjection()).toMatchObject({
      status: "unavailable",
      reason: "PROJECTION_INPUT_INVALID",
    });
  });
});
