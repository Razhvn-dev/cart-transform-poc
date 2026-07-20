import { describe, expect, it } from "vitest";

import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import {
  PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION,
  resolvePrebuiltBundleSelection,
} from "./prebuilt-bundle-runtime.selection.js";

const REVISION_ID = "77770000-0000-4000-8000-000000000001";

function fixture({ fixedSelections } = {}) {
  const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
  const defaultSelections = Object.fromEntries(
    snapshot.groups.map((group) => [group.key, group.default_option]),
  );
  return {
    snapshot,
    mapping: {
      schema_version: PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION,
      parent_variant_gid: snapshot.parent.variant_gid,
      bundle_definition_id: snapshot.configuration_id,
      published_revision_id: REVISION_ID,
      status: "published",
      pilot_scope_approved: true,
      snapshot_checksum: snapshot.checksum,
      fixed_selections: fixedSelections ?? defaultSelections,
    },
  };
}

describe("pre-built Bundle fixed-selection resolver", () => {
  it("resolves published fixed selections without any Builder cart attributes", () => {
    const { snapshot, mapping } = fixture();
    const result = resolvePrebuiltBundleSelection({
      parent_variant_gid: snapshot.parent.variant_gid,
      mapping,
      snapshot,
      client_selections: { _builder_efi_variant_id: "malicious-client-value" },
    });

    expect(result.status).toBe("resolved");
    expect(result.resolved.components.map((component) => component.variantId)).toEqual([
      "gid://shopify/ProductVariant/51552319766806",
      "gid://shopify/ProductVariant/51505348346134",
      "gid://shopify/ProductVariant/51552321011990",
    ]);
    expect(result.resolved.components.map((component) => component.fixedPricePerUnit)).toEqual([
      "512.99",
      "190.00",
      "47.49",
    ]);
  });

  it("resolves an advanced fixed selection including Display", () => {
    const { snapshot, mapping } = fixture({
      fixedSelections: {
        efi_system: "efi_killshot_2_pro",
        fuel_system: "fuel_test_2",
        ignition: "ignition_high_roller_cdi",
        display: "display_8_hd_handheld",
      },
    });
    const result = resolvePrebuiltBundleSelection({ parent_variant_gid: snapshot.parent.variant_gid, mapping, snapshot });

    expect(result.status).toBe("resolved");
    expect(result.resolved.components.map((component) => component.variantId)).toEqual([
      "gid://shopify/ProductVariant/51552319865110",
      "gid://shopify/ProductVariant/51518319591702",
      "gid://shopify/ProductVariant/51552321110294",
      "gid://shopify/ProductVariant/51552322584854",
    ]);
  });

  it("fails closed for missing, mismatched, unpublished, or checksum-invalid mappings", () => {
    const { snapshot, mapping } = fixture();
    expect(resolvePrebuiltBundleSelection({ parent_variant_gid: snapshot.parent.variant_gid, snapshot }).reason)
      .toBe("UNMAPPED_PARENT_VARIANT");
    expect(resolvePrebuiltBundleSelection({ parent_variant_gid: "gid://shopify/ProductVariant/999", mapping, snapshot }).reason)
      .toBe("UNMAPPED_PARENT_VARIANT");
    expect(resolvePrebuiltBundleSelection({
      parent_variant_gid: snapshot.parent.variant_gid,
      mapping: { ...mapping, status: "draft" },
      snapshot,
    }).reason).toBe("INVALID_MAPPING");
    expect(resolvePrebuiltBundleSelection({
      parent_variant_gid: snapshot.parent.variant_gid,
      mapping: { ...mapping, snapshot_checksum: "stale" },
      snapshot,
    }).reason).toBe("SNAPSHOT_CHECKSUM_MISMATCH");
  });

  it("rejects incomplete or unknown fixed selections and returns a fresh immutable result", () => {
    const { snapshot, mapping } = fixture({
      fixedSelections: { efi_system: "efi_killshot_fusion_lite", unknown_group: "unexpected" },
    });
    const rejected = resolvePrebuiltBundleSelection({ parent_variant_gid: snapshot.parent.variant_gid, mapping, snapshot });
    expect(rejected).toMatchObject({ status: "unresolved", reason: "INVALID_FIXED_SELECTIONS" });

    const valid = fixture();
    const resolved = resolvePrebuiltBundleSelection({
      parent_variant_gid: valid.snapshot.parent.variant_gid,
      mapping: valid.mapping,
      snapshot: valid.snapshot,
    });
    valid.snapshot.groups[0].options[0].label = "mutated after resolution";
    expect(resolved.resolved.components[0].title).not.toBe("mutated after resolution");
    expect(Object.isFrozen(resolved)).toBe(true);
  });
});
