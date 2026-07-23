import { describe, expect, it } from "vitest";
import { run } from "../run.js";
import { BUNDLE_RUNTIME_SCHEMA_VERSION } from "./bundle-config.schema.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { stableSerialize } from "./bundle-runtime.checksum.js";
import {
  RuntimeSnapshotValidationError,
  assertValidRuntimeSnapshot,
  validateRuntimeSnapshot,
} from "./bundle-runtime.validator.js";
import { resolveRuntimeBundleSelection } from "./bundle-runtime.resolver.js";

const MASTER_KIT_VARIANT_ID = "gid://shopify/ProductVariant/51505325605142";
const EFI_FUSION_LITE = "gid://shopify/ProductVariant/51592538587414";
const EFI_KILLSHOT_2_PRO = "gid://shopify/ProductVariant/51552319865110";
const FUEL_TEST = "gid://shopify/ProductVariant/51505348346134";
const FUEL_TEST_2 = "gid://shopify/ProductVariant/51518319591702";
const IGNITION_BLACK_JACK = "gid://shopify/ProductVariant/51592730706198";
const IGNITION_HIGH_ROLLER = "gid://shopify/ProductVariant/51552321110294";
const DISPLAY_8_HD = "gid://shopify/ProductVariant/51552322584854";
const PARENT_PRODUCT_GID = "gid://shopify/Product/999";

function attribute(value) {
  return { value };
}

function masterLine(attributes = {}) {
  return {
    id: "gid://shopify/CartLine/99",
    quantity: 1,
    merchandise: {
      __typename: "ProductVariant",
      id: MASTER_KIT_VARIANT_ID,
      product: {
        id: PARENT_PRODUCT_GID,
      },
    },
    ...attributes,
  };
}

function runHardCoded(attributes) {
  return run({
    cart: {
      lines: [masterLine(attributes)],
    },
  }).operations[0].expand.expandedCartItems;
}

function resolveSnapshot(attributes) {
  return resolveRuntimeBundleSelection(compileRuntimeSnapshot(masterKitConfigV1), {
    _builder_efi_variant_id: attributes.builderEfiVariantId?.value,
    _builder_fuel_variant_id: attributes.builderFuelVariantId?.value,
    _builder_ignition_variant_id: attributes.builderIgnitionVariantId?.value,
    _builder_display_variant_id: attributes.builderDisplayVariantId?.value,
  }).components;
}

function hardCodedProjection(items) {
  return items.map((item) => ({
    merchandiseId: item.merchandiseId,
    quantity: item.quantity,
    amount: item.price.adjustment.fixedPricePerUnit.amount,
  }));
}

function snapshotProjection(components) {
  return components.map((component) => ({
    merchandiseId: component.variantId,
    quantity: 1,
    amount: component.fixedPricePerUnit,
  }));
}

function expectSnapshotParity(attributes) {
  expect(snapshotProjection(resolveSnapshot(attributes)))
    .toEqual(hardCodedProjection(runHardCoded(attributes)));
}

describe("bundle runtime snapshot compiler", () => {
  it("compiles a deterministic Function-ready runtime snapshot", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const snapshotAgain = compileRuntimeSnapshot(masterKitConfigV1);

    expect(snapshot.snapshot_schema).toBe(BUNDLE_RUNTIME_SCHEMA_VERSION);
    expect(snapshot.configuration_id).toBe(masterKitConfigV1.configuration_id);
    expect(snapshot.configuration_version).toBe(masterKitConfigV1.configuration_version);
    expect(snapshot.slug).toBe(masterKitConfigV1.slug);
    expect(snapshot.groups.map((group) => group.key)).toEqual([
      "efi_system",
      "fuel_system",
      "ignition",
      "display",
    ]);
    expect(stableSerialize(snapshot)).toBe(stableSerialize(snapshotAgain));
    expect(validateRuntimeSnapshot(snapshot)).toEqual([]);
  });

  it("excludes authoring-only and audit-only fields", () => {
    const serialized = stableSerialize(compileRuntimeSnapshot(masterKitConfigV1));

    expect(serialized).not.toContain("audit");
    expect(serialized).not.toContain("revision");
    expect(serialized).not.toContain("description");
    expect(serialized).not.toContain("internal_name");
    expect(serialized).not.toContain("help_text");
    expect(serialized).not.toContain("price_source");
    expect(serialized).not.toContain("effective_from");
    expect(serialized).not.toContain("effective_to");
  });

  it("keeps only active options and active storefront presets", () => {
    const config = structuredClone(masterKitConfigV1);
    config.component_groups[0].options.push({
      ...config.component_groups[0].options[0],
      option_key: "efi_inactive_test",
      variant_gid: "gid://shopify/ProductVariant/999999999",
      sort_order: 30,
      active: false,
    });
    config.presets.push({
      ...config.presets[0],
      preset_id: "inactive_test_preset",
      display_order: 30,
      active: false,
    });

    const snapshot = compileRuntimeSnapshot(config);

    expect(snapshot.groups[0].options.map((option) => option.key))
      .toEqual(["efi_killshot_fusion_lite", "efi_killshot_2_pro"]);
    expect(snapshot.presets.map((preset) => preset.id))
      .toEqual(["standard_build", "advanced_build"]);
  });

  it("detects checksum mismatches after snapshot mutation", () => {
    const snapshot = structuredClone(compileRuntimeSnapshot(masterKitConfigV1));
    snapshot.groups[0].options[0].price_cents += 1;

    expect(validateRuntimeSnapshot(snapshot)).toContain(
      "checksum does not match snapshot content",
    );
    expect(() => assertValidRuntimeSnapshot(snapshot))
      .toThrow(RuntimeSnapshotValidationError);
  });

  it("keeps future metadata fields for Bundle Metadata Contract V1 progression", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);

    expect(snapshot.metadata.future_fields).toEqual(expect.arrayContaining([
      "_configuration_id",
      "_configuration_version",
      "_selection_key",
      "_preset_id",
      "_component_required",
    ]));
  });
});

describe("bundle runtime snapshot parity", () => {
  it("matches Standard Build component expansion and pricing", () => {
    expectSnapshotParity({
      builderEfiVariantId: attribute(EFI_FUSION_LITE),
      builderFuelVariantId: attribute(FUEL_TEST),
      builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
    });
  });

  it("matches Advanced Build component expansion and pricing", () => {
    expectSnapshotParity({
      builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
      builderFuelVariantId: attribute(FUEL_TEST_2),
      builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
      builderDisplayVariantId: attribute(DISPLAY_8_HD),
    });
  });

  it("matches hard-coded fallback behavior for invalid selections", () => {
    expectSnapshotParity({
      builderEfiVariantId: attribute("gid://shopify/ProductVariant/1"),
      builderFuelVariantId: attribute("gid://shopify/ProductVariant/2"),
      builderIgnitionVariantId: attribute("gid://shopify/ProductVariant/3"),
      builderDisplayVariantId: attribute("gid://shopify/ProductVariant/4"),
    });
  });

  it("matches EFI/Fuel compatibility fallback and hidden Display exclusion", () => {
    const attributes = {
      builderEfiVariantId: attribute(EFI_FUSION_LITE),
      builderFuelVariantId: attribute(FUEL_TEST_2),
      builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
      builderDisplayVariantId: attribute(DISPLAY_8_HD),
    };

    const components = resolveSnapshot(attributes);
    expect(components.map((component) => component.variantId))
      .toEqual([EFI_FUSION_LITE, FUEL_TEST, IGNITION_BLACK_JACK]);
    expectSnapshotParity(attributes);
  });
});
