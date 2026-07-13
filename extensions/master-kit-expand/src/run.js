// @ts-check

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

const MASTER_KIT_VARIANT_ID =
  "gid://shopify/ProductVariant/51505325605142";
const MASTER_KIT_DISPLAY_TITLE = "Master Kit Test";

const BUNDLE_DISCOUNT_BASIS_POINTS = 500;

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

  const expandedCartItems = components
    .map((component, index) => ({
      merchandiseId: component.variantId,
      quantity: 1,
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
  const componentIds = [efiVariantId, fuelVariantId, ignitionVariantId];

  if (efiVariantId !== VARIANT_IDS.EFI_FUSION_LITE) {
    componentIds.push(
      resolveVariant("display", cartLine.builderDisplayVariantId?.value),
    );
  }

  return componentIds.map((variantId) => ({
    variantId,
    priceCents: getComponentPriceCents(variantId),
  }));
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
