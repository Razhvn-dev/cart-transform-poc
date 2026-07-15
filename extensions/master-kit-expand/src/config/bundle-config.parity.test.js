import { describe, expect, it } from "vitest";
import { run } from "../run.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { resolveBundleSelection } from "./bundle-config.resolver.js";

const MASTER_KIT_VARIANT_ID = "gid://shopify/ProductVariant/51505325605142";
const EFI_FUSION_LITE = "gid://shopify/ProductVariant/51552319766806";
const EFI_KILLSHOT_2_PRO = "gid://shopify/ProductVariant/51552319865110";
const FUEL_TEST = "gid://shopify/ProductVariant/51505348346134";
const FUEL_TEST_2 = "gid://shopify/ProductVariant/51518319591702";
const IGNITION_BLACK_JACK = "gid://shopify/ProductVariant/51552321011990";
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

function resolveShadow(attributes) {
  return resolveBundleSelection(masterKitConfigV1, {
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

function shadowProjection(components) {
  return components.map((component) => ({
    merchandiseId: component.variantId,
    quantity: 1,
    amount: component.fixedPricePerUnit,
  }));
}

function expectParity(attributes) {
  expect(shadowProjection(resolveShadow(attributes)))
    .toEqual(hardCodedProjection(runHardCoded(attributes)));
}

describe("bundle config shadow parity", () => {
  it("matches Standard Build component expansion and pricing", () => {
    expectParity({
      builderEfiVariantId: attribute(EFI_FUSION_LITE),
      builderFuelVariantId: attribute(FUEL_TEST),
      builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
    });
  });

  it("matches Advanced Build component expansion and pricing", () => {
    expectParity({
      builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
      builderFuelVariantId: attribute(FUEL_TEST_2),
      builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
      builderDisplayVariantId: attribute(DISPLAY_8_HD),
    });
  });

  it("matches hard-coded fallback behavior for invalid selections", () => {
    expectParity({
      builderEfiVariantId: attribute("gid://shopify/ProductVariant/1"),
      builderFuelVariantId: attribute("gid://shopify/ProductVariant/2"),
      builderIgnitionVariantId: attribute("gid://shopify/ProductVariant/3"),
      builderDisplayVariantId: attribute("gid://shopify/ProductVariant/4"),
    });
  });

  it("matches EFI/Fuel compatibility fallback", () => {
    const attributes = {
      builderEfiVariantId: attribute(EFI_FUSION_LITE),
      builderFuelVariantId: attribute(FUEL_TEST_2),
      builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
    };

    expect(resolveShadow(attributes).map((component) => component.variantId))
      .toEqual([EFI_FUSION_LITE, FUEL_TEST, IGNITION_BLACK_JACK]);
    expectParity(attributes);
  });

  it("matches hidden Display exclusion for Fusion Lite", () => {
    const attributes = {
      builderEfiVariantId: attribute(EFI_FUSION_LITE),
      builderFuelVariantId: attribute(FUEL_TEST),
      builderIgnitionVariantId: attribute(IGNITION_BLACK_JACK),
      builderDisplayVariantId: attribute(DISPLAY_8_HD),
    };

    expect(resolveShadow(attributes).some((component) => component.variantId === DISPLAY_8_HD))
      .toBe(false);
    expectParity(attributes);
  });

  it("matches allow-listed Fuel Test 2 with whitespace", () => {
    expectParity({
      builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
      builderFuelVariantId: attribute(` ${FUEL_TEST_2} `),
      builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
      builderDisplayVariantId: attribute(DISPLAY_8_HD),
    });
  });

  it("produces trusted component metadata values for future contract fields", () => {
    const components = resolveShadow({
      builderEfiVariantId: attribute(EFI_KILLSHOT_2_PRO),
      builderFuelVariantId: attribute(FUEL_TEST_2),
      builderIgnitionVariantId: attribute(IGNITION_HIGH_ROLLER),
      builderDisplayVariantId: attribute(DISPLAY_8_HD),
    });

    expect(components.map((component) => ({
      group: component.componentGroup,
      role: component.componentRole,
      sequence: String(component.sequence),
      variant: component.variantId,
    }))).toEqual([
      {
        group: "efi_system",
        role: "efi",
        sequence: "1",
        variant: EFI_KILLSHOT_2_PRO,
      },
      {
        group: "fuel_system",
        role: "fuel_delivery",
        sequence: "2",
        variant: FUEL_TEST_2,
      },
      {
        group: "ignition",
        role: "ignition",
        sequence: "3",
        variant: IGNITION_HIGH_ROLLER,
      },
      {
        group: "display",
        role: "display_controller",
        sequence: "4",
        variant: DISPLAY_8_HD,
      },
    ]);
  });
});
