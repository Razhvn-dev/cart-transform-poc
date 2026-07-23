import { describe, expect, it } from "vitest";

import { run as runHardcodedBuilder } from "../run.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION } from "./prebuilt-bundle-runtime.selection.js";
import { preparePrebuiltBundleRuntimeSelections } from "./prebuilt-bundle-runtime.preparation.js";
import { buildPrebuiltBundleFunctionResult } from "./prebuilt-bundle-runtime.result.js";

function snapshotAndMapping(fixedSelections) {
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
      fixed_selections: fixedSelections ?? Object.fromEntries(
        snapshot.groups.map((group) => [group.key, group.default_option]),
      ),
    },
  };
}

function prebuiltResult(lines, fixedSelections) {
  const { snapshot, mapping } = snapshotAndMapping(fixedSelections);
  return buildPrebuiltBundleFunctionResult(preparePrebuiltBundleRuntimeSelections(lines, {
    lookupMapping: (variantId) => variantId === snapshot.parent.variant_gid ? mapping : null,
    lookupSnapshot: () => snapshot,
  }));
}

function builderInput({
  efi = "gid://shopify/ProductVariant/51592538587414",
  fuel = "gid://shopify/ProductVariant/51505348346134",
  ignition = "gid://shopify/ProductVariant/51592730706198",
  display,
} = {}) {
  const line = {
    id: "gid://shopify/CartLine/builder",
    merchandise: {
      __typename: "ProductVariant",
      id: "gid://shopify/ProductVariant/51505325605142",
      product: { id: "gid://shopify/Product/10600519598358" },
    },
    builderEfiVariantId: { value: efi },
    builderFuelVariantId: { value: fuel },
    builderIgnitionVariantId: { value: ignition },
  };
  if (display) line.builderDisplayVariantId = { value: display };

  return {
    cart: {
      lines: [line],
    },
  };
}

function projection(result) {
  return result.operations.map((operation) => ({
    cartLineId: operation.expand.cartLineId,
    components: operation.expand.expandedCartItems.map((item) => ({
      merchandiseId: item.merchandiseId,
      quantity: item.quantity,
      amount: item.price.adjustment.fixedPricePerUnit.amount,
    })),
  }));
}

describe("two purchase paths local runtime semantics", () => {
  it("keeps Builder and fixed pre-built Standard paths aligned on components and prices", () => {
    const builder = projection(runHardcodedBuilder(builderInput()));
    const { snapshot } = snapshotAndMapping();
    const prebuilt = projection(prebuiltResult([{
      id: "gid://shopify/CartLine/prebuilt",
      merchandise: { __typename: "ProductVariant", id: snapshot.parent.variant_gid },
    }]));

    expect(builder[0].components).toEqual(prebuilt[0].components);
    expect(prebuilt[0].cartLineId).toBe("gid://shopify/CartLine/prebuilt");
  });

  it("keeps Builder and fixed pre-built Advanced paths aligned including Display", () => {
    const fixedSelections = {
      efi_system: "efi_killshot_2_pro",
      fuel_system: "fuel_test_2",
      ignition: "ignition_high_roller_cdi",
      display: "display_8_hd_handheld",
    };
    const builder = projection(runHardcodedBuilder(builderInput({
      efi: "gid://shopify/ProductVariant/51552319865110",
      fuel: "gid://shopify/ProductVariant/51518319591702",
      ignition: "gid://shopify/ProductVariant/51552321110294",
      display: "gid://shopify/ProductVariant/51552322584854",
    })));
    const { snapshot } = snapshotAndMapping(fixedSelections);
    const prebuilt = projection(prebuiltResult([{
      id: "gid://shopify/CartLine/prebuilt-advanced",
      merchandise: { __typename: "ProductVariant", id: snapshot.parent.variant_gid },
    }], fixedSelections));

    expect(builder[0].components).toEqual(prebuilt[0].components);
    expect(prebuilt[0].components).toHaveLength(4);
    expect(prebuilt[0].cartLineId).toBe("gid://shopify/CartLine/prebuilt-advanced");
  });

  it("keeps multiple pre-built cart lines independent and leaves unrelated SKUs untouched", () => {
    const { snapshot } = snapshotAndMapping();
    const result = prebuiltResult([
      { id: "gid://shopify/CartLine/prebuilt-a", merchandise: { __typename: "ProductVariant", id: snapshot.parent.variant_gid } },
      { id: "gid://shopify/CartLine/unrelated", merchandise: { __typename: "ProductVariant", id: "gid://shopify/ProductVariant/999" } },
      { id: "gid://shopify/CartLine/prebuilt-b", merchandise: { __typename: "ProductVariant", id: snapshot.parent.variant_gid } },
    ]);

    expect(projection(result).map((operation) => operation.cartLineId)).toEqual([
      "gid://shopify/CartLine/prebuilt-a",
      "gid://shopify/CartLine/prebuilt-b",
    ]);
  });
});
