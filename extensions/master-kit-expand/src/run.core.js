// @ts-check

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

const MASTER_KIT_VARIANT_ID =
  "gid://shopify/ProductVariant/51505325605142";
const MASTER_KIT_DISPLAY_TITLE = "Master Kit Test";

const BUNDLE_SCHEMA_VERSION = "1";
const BUNDLE_DISCOUNT_BASIS_POINTS = 500;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_GID_REGEX = /^gid:\/\/shopify\/Product\/\d+$/;

const VARIANT_IDS = {
  EFI_FUSION_LITE: "gid://shopify/ProductVariant/51552319766806",
  EFI_KILLSHOT_2_PRO: "gid://shopify/ProductVariant/51552319865110",
  FUEL_TEST: "gid://shopify/ProductVariant/51505348346134",
  FUEL_TEST_2: "gid://shopify/ProductVariant/51518319591702",
  IGNITION_BLACK_JACK: "gid://shopify/ProductVariant/51552321011990",
  IGNITION_HIGH_ROLLER: "gid://shopify/ProductVariant/51552321110294",
  DISPLAY_5_HD: "gid://shopify/ProductVariant/51552321175830",
  DISPLAY_8_HD: "gid://shopify/ProductVariant/51552322584854",
};

const TRUSTED_COMPONENTS = {
  efi: {
    fallback: VARIANT_IDS.EFI_FUSION_LITE,
    variants: {
      [VARIANT_IDS.EFI_FUSION_LITE]: { priceCents: 53999 },
      [VARIANT_IDS.EFI_KILLSHOT_2_PRO]: { priceCents: 78999 },
    },
  },
  fuel: {
    fallback: VARIANT_IDS.FUEL_TEST,
    variants: {
      [VARIANT_IDS.FUEL_TEST]: { priceCents: 20000 },
      [VARIANT_IDS.FUEL_TEST_2]: { priceCents: 35000 },
    },
  },
  ignition: {
    fallback: VARIANT_IDS.IGNITION_BLACK_JACK,
    variants: {
      [VARIANT_IDS.IGNITION_BLACK_JACK]: { priceCents: 4999 },
      [VARIANT_IDS.IGNITION_HIGH_ROLLER]: { priceCents: 34299 },
    },
  },
  display: {
    fallback: VARIANT_IDS.DISPLAY_5_HD,
    variants: {
      [VARIANT_IDS.DISPLAY_5_HD]: { priceCents: 34599 },
      [VARIANT_IDS.DISPLAY_8_HD]: { priceCents: 64999 },
    },
  },
};

const COMPONENT_METADATA = {
  efi: {
    group: "efi_system",
    role: "efi",
  },
  fuel: {
    group: "fuel_system",
    role: "fuel_delivery",
  },
  ignition: {
    group: "ignition",
    role: "ignition",
  },
  display: {
    group: "display",
    role: "display_controller",
  },
};

/** @type {FunctionRunResult} */
const NO_CHANGES = { operations: [] };

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
  const operations = input.cart.lines.reduce((acc, cartLine) => {
    const expandOperation = buildExpandOperation(cartLine);
    return expandOperation ? [...acc, { expand: expandOperation }] : acc;
  }, /** @type {FunctionRunResult['operations']} */ ([]));

  return operations.length > 0 ? { operations } : NO_CHANGES;
}

/**
 * @param {RunInput['cart']['lines'][number]} cartLine
 */
function buildExpandOperation(cartLine) {
  const { id: cartLineId, merchandise } = cartLine;

  if (merchandise.__typename !== "ProductVariant") {
    return null;
  }

  if (merchandise.id !== MASTER_KIT_VARIANT_ID) {
    return null;
  }

  const components = getSelectedComponents(cartLine);
  const allocatedPrices = allocateDiscountedPrices(components);
  const bundleMetadata = getProductionBundleMetadata(
    cartLine,
    merchandise.id,
    merchandise.product.id,
  );

  const expandedCartItems = components
    .map((component, index) => ({
      merchandiseId: component.variantId,
      quantity: 1,
      ...(bundleMetadata
        ? {
            attributes: buildExpandedItemAttributes(
              bundleMetadata,
              component,
              index,
            ),
          }
        : {}),
      price: {
        adjustment: {
          fixedPricePerUnit: {
            amount: centsToDecimalString(allocatedPrices[index]),
          },
        },
      },
    }));

  return {
    cartLineId,
    title: MASTER_KIT_DISPLAY_TITLE,
    expandedCartItems,
  };
}

/**
 * @param {RunInput['cart']['lines'][number]} cartLine
 */
function getSelectedComponents(cartLine) {
  const efiVariantId = resolveVariant(
    "efi",
    cartLine.builderEfiVariantId?.value,
  );
  const fuelVariantId = resolveFuelVariant(cartLine, efiVariantId);
  const ignitionVariantId = resolveVariant(
    "ignition",
    cartLine.builderIgnitionVariantId?.value,
  );
  const components = [
    buildSelectedComponent("efi", efiVariantId),
    buildSelectedComponent("fuel", fuelVariantId),
    buildSelectedComponent("ignition", ignitionVariantId),
  ];

  if (efiVariantId !== VARIANT_IDS.EFI_FUSION_LITE) {
    components.push(
      buildSelectedComponent(
        "display",
        resolveVariant("display", cartLine.builderDisplayVariantId?.value),
      ),
    );
  }

  return components;
}

/**
 * @param {keyof typeof COMPONENT_METADATA} slot
 * @param {string} variantId
 */
function buildSelectedComponent(slot, variantId) {
  return {
    slot,
    variantId,
    priceCents: getComponentPriceCents(variantId),
  };
}

/**
 * @param {keyof typeof TRUSTED_COMPONENTS} group
 * @param {string | null | undefined} requestedVariantId
 */
function resolveVariant(group, requestedVariantId) {
  const catalog = TRUSTED_COMPONENTS[group];
  const variantId = requestedVariantId?.trim();

  return variantId && catalog.variants[variantId] ? variantId : catalog.fallback;
}

/**
 * @param {RunInput['cart']['lines'][number]} cartLine
 * @param {string} efiVariantId
 */
function resolveFuelVariant(cartLine, efiVariantId) {
  const requestedFuelVariantId = resolveVariant(
    "fuel",
    cartLine.builderFuelVariantId?.value,
  );

  if (
    efiVariantId === VARIANT_IDS.EFI_FUSION_LITE &&
    requestedFuelVariantId === VARIANT_IDS.FUEL_TEST_2
  ) {
    return VARIANT_IDS.FUEL_TEST;
  }

  return requestedFuelVariantId;
}

/**
 * @param {string} variantId
 */
function getComponentPriceCents(variantId) {
  for (const catalog of Object.values(TRUSTED_COMPONENTS)) {
    const component = catalog.variants[variantId];
    if (component) return component.priceCents;
  }

  return 0;
}

/**
 * @param {RunInput['cart']['lines'][number]} cartLine
 * @param {string} authoritativeParentVariantGid
 * @param {string} authoritativeParentProductGid
 */
function getProductionBundleMetadata(
  cartLine,
  authoritativeParentVariantGid,
  authoritativeParentProductGid,
) {
  const bundleId = cartLine.bundleId?.value?.trim();
  const schemaVersion = cartLine.bundleSchemaVersion?.value?.trim();
  const parentSku = cartLine.parentSku?.value ?? "";
  const parentTitle = cartLine.parentTitle?.value ?? "";

  if (
    !isUuid(bundleId) ||
    schemaVersion !== BUNDLE_SCHEMA_VERSION ||
    !isProductGid(authoritativeParentProductGid)
  ) {
    return null;
  }

  return {
    bundleId,
    schemaVersion,
    parentProductGid: authoritativeParentProductGid,
    parentVariantGid: authoritativeParentVariantGid,
    parentSku,
    parentTitle,
  };
}

/**
 * @param {ReturnType<typeof getProductionBundleMetadata>} bundleMetadata
 * @param {{slot: keyof typeof COMPONENT_METADATA, variantId: string}} component
 * @param {number} index
 */
function buildExpandedItemAttributes(bundleMetadata, component, index) {
  const metadata = COMPONENT_METADATA[component.slot];

  return [
    attribute("_bundle_id", bundleMetadata.bundleId),
    attribute("_bundle_schema_version", bundleMetadata.schemaVersion),
    attribute("_parent_product_gid", bundleMetadata.parentProductGid),
    attribute("_parent_variant_gid", bundleMetadata.parentVariantGid),
    attribute("_parent_sku", bundleMetadata.parentSku),
    attribute("_parent_title", bundleMetadata.parentTitle),
    attribute("_component_group", metadata.group),
    attribute("_component_role", metadata.role),
    attribute("_component_variant_gid", component.variantId),
    attribute("_component_sequence", String(index + 1)),
  ];
}

/**
 * @param {string} key
 * @param {string} value
 */
function attribute(key, value) {
  return { key, value };
}

/**
 * @param {string | null | undefined} value
 */
function isUuid(value) {
  return typeof value === "string" && UUID_REGEX.test(value);
}

/**
 * @param {string | null | undefined} value
 */
function isProductGid(value) {
  return typeof value === "string" && PRODUCT_GID_REGEX.test(value);
}

/**
 * @param {Array<{priceCents: number}>} components
 */
function allocateDiscountedPrices(components) {
  const subtotalCents = components.reduce(
    (total, component) => total + component.priceCents,
    0,
  );
  const finalTotalCents =
    subtotalCents - calculatePercentageDiscountCents(subtotalCents);
  const allocatedPrices = components.map((component) =>
    component.priceCents - calculatePercentageDiscountCents(component.priceCents),
  );
  const allocatedTotalCents = allocatedPrices.reduce(
    (total, priceCents) => total + priceCents,
    0,
  );
  const deltaCents = finalTotalCents - allocatedTotalCents;

  if (allocatedPrices.length > 0) {
    allocatedPrices[allocatedPrices.length - 1] += deltaCents;
  }

  return allocatedPrices;
}

/**
 * @param {number} priceCents
 */
function calculatePercentageDiscountCents(priceCents) {
  return Math.floor((priceCents * BUNDLE_DISCOUNT_BASIS_POINTS + 5000) / 10000);
}

/**
 * @param {number} cents
 */
function centsToDecimalString(cents) {
  const dollars = Math.floor(cents / 100);
  const centsRemainder = String(cents % 100).padStart(2, "0");

  return `${dollars}.${centsRemainder}`;
}
