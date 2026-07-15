document.addEventListener("change", (event) => {
  const form = event.target.closest("[data-product-builder-form]");

  if (!form) {
    return;
  }

  window.PBCompat?.apply(form);
  renderPriceSummary(form);
  renderProductImage(form, event.target);
});

document.addEventListener("DOMContentLoaded", () => {
  document
    .querySelectorAll("[data-product-builder-form]")
    .forEach((form) => {
      window.PBCompat?.apply(form);
      renderPriceSummary(form);
      renderProductImage(form);
    });
});

let isBuilderSubmitting = false;

async function handleBuilderAddToCart(form) {
  if (isBuilderSubmitting) return;
  isBuilderSubmitting = true;

  const submitButton = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const builder = form.closest("[data-product-builder]");
  const variantId = Number(formData.get("id"));
  const efiVariantId = getSelectedVariantGid(form, "_builder_efi_variant_id");
  const fuelVariantId = getSelectedVariantGid(form, "_builder_fuel_variant_id");
  const ignitionVariantId = getSelectedVariantGid(
    form,
    "_builder_ignition_variant_id",
  );
  const displayVariantId = getSelectedVariantGid(
    form,
    "_builder_display_variant_id",
  );
  const parentMetadata = getParentMetadata(builder);

  if (
    !variantId ||
    !efiVariantId ||
    !fuelVariantId ||
    !ignitionVariantId ||
    !parentMetadata
  ) {
    isBuilderSubmitting = false;
    return;
  }

  if (submitButton) submitButton.disabled = true;

  try {
    const properties = {
      _bundle_id: generateBundleId(),
      _bundle_schema_version: "1",
      _parent_product_gid: parentMetadata.productGid,
      _parent_variant_gid: parentMetadata.variantGid,
      _parent_sku: parentMetadata.sku,
      _parent_title: parentMetadata.title,
      _builder_efi_variant_id: efiVariantId,
      _builder_fuel_variant_id: fuelVariantId,
      _builder_ignition_variant_id: ignitionVariantId,
    };

    if (displayVariantId) {
      properties._builder_display_variant_id = displayVariantId;
    }

    const response = await fetch("/cart/add.js", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            id: variantId,
            quantity: 1,
            properties,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error("Add to cart failed");
    }

    window.location.href = "/cart";
  } finally {
    if (submitButton) submitButton.disabled = false;
    isBuilderSubmitting = false;
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-builder-add-to-cart]");
  if (!button) return;

  const form = button.closest("[data-product-builder-form]");
  if (!form) return;

  event.preventDefault();
  await handleBuilderAddToCart(form);
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-product-builder-form]");
  if (!form) return;

  event.preventDefault();
  await handleBuilderAddToCart(form);
});

function getSelectedVariantGid(form, name) {
  const select = form.querySelector(`select[name="${name}"]`);

  if (!select || select.disabled || select.closest("[hidden]")) {
    return null;
  }

  const selectedValue = select.selectedOptions[0]?.value;
  if (isVariantGid(selectedValue)) return selectedValue;

  return Array.from(select.options).find((option) => isVariantGid(option.value))
    ?.value || null;
}

function isVariantGid(value) {
  return (
    typeof value === "string" &&
    /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(value)
  );
}

function getParentMetadata(builder) {
  if (!builder) {
    return null;
  }

  const { parentProductGid, parentVariantGid, parentSku, parentTitle } =
    builder.dataset;

  if (!isProductGid(parentProductGid) || !isVariantGid(parentVariantGid)) {
    return null;
  }

  return {
    productGid: parentProductGid,
    variantGid: parentVariantGid,
    sku: parentSku || "",
    title: parentTitle || "",
  };
}

function isProductGid(value) {
  return (
    typeof value === "string" &&
    /^gid:\/\/shopify\/Product\/\d+$/.test(value)
  );
}

function generateBundleId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    throw new Error("Secure UUID generation is unavailable");
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function parseMoneyValue(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSelectedOptionPrices(form) {
  const selectedOptions = form.querySelectorAll(
    'select option:checked[data-affects-pricing="true"]',
  );

  return Array.from(selectedOptions)
    .filter((option) => {
      const select = option.closest("select");
      return select && !select.disabled && !select.closest("[hidden]");
    })
    .map((option) => parseMoneyValue(option.dataset.priceAdjustmentCents));
}

function calculateBuilderTotal(form) {
  const builder = form.closest("[data-product-builder]");
  const basePriceCents = parseMoneyValue(builder?.dataset.basePriceCents);
  const bundleDiscountBasisPoints = parseMoneyValue(
    builder?.dataset.bundleDiscountBasisPoints,
  );
  const selectedOptionPrices = getSelectedOptionPrices(form);
  const selectedOptionsAdjustmentCents = selectedOptionPrices.reduce(
    (total, adjustmentCents) => total + adjustmentCents,
    0,
  );
  const configurationTotalCents =
    basePriceCents + selectedOptionsAdjustmentCents;
  const bundleDiscountCents = calculatePercentageDiscountCents(
    configurationTotalCents,
    bundleDiscountBasisPoints,
  );

  return {
    basePriceCents,
    selectedOptionsAdjustmentCents,
    configurationTotalCents,
    bundleDiscountCents,
    finalTotalCents: configurationTotalCents - bundleDiscountCents,
  };
}

function calculatePercentageDiscountCents(totalCents, basisPoints) {
  return Math.floor((totalCents * basisPoints + 5000) / 10000);
}

function formatMoney(cents, moneyFormat) {
  const format = moneyFormat || ["$", "{{amount}}"].join("");
  const [dollars, decimalValue] = (Math.abs(cents) / 100)
    .toFixed(2)
    .split(".");
  const formattedAmount = `${dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimalValue}`;

  return `${cents < 0 ? "-" : ""}${format.replace(/\{\{[^}]+\}\}/, formattedAmount)}`;
}

function formatAdjustmentMoney(cents, moneyFormat) {
  return cents > 0 ? `+${formatMoney(cents, moneyFormat)}` : formatMoney(cents, moneyFormat);
}

function formatDiscountMoney(cents, moneyFormat) {
  return cents > 0 ? `-${formatMoney(cents, moneyFormat)}` : formatMoney(0, moneyFormat);
}

function renderPriceSummary(form) {
  const builder = form.closest("[data-product-builder]");

  if (!builder) {
    return;
  }

  const moneyFormat = builder.dataset.moneyFormat;
  const pricing = calculateBuilderTotal(form);
  const basePriceElement = builder.querySelector("[data-builder-base-price]");
  const selectedOptionsElement = builder.querySelector(
    "[data-builder-selected-options]",
  );
  const configurationTotalElement = builder.querySelector(
    "[data-builder-configuration-total]",
  );
  const bundleDiscountElement = builder.querySelector(
    "[data-builder-bundle-discount]",
  );
  const finalTotalElement = builder.querySelector(
    "[data-builder-final-total]",
  );

  if (basePriceElement) {
    basePriceElement.textContent = formatMoney(
      pricing.basePriceCents,
      moneyFormat,
    );
  }

  if (selectedOptionsElement) {
    selectedOptionsElement.textContent = formatAdjustmentMoney(
      pricing.selectedOptionsAdjustmentCents,
      moneyFormat,
    );
  }

  if (configurationTotalElement) {
    configurationTotalElement.textContent = formatMoney(
      pricing.configurationTotalCents,
      moneyFormat,
    );
  }

  if (bundleDiscountElement) {
    bundleDiscountElement.textContent = formatDiscountMoney(
      pricing.bundleDiscountCents,
      moneyFormat,
    );
  }

  if (finalTotalElement) {
    finalTotalElement.textContent = formatMoney(pricing.finalTotalCents, moneyFormat);
  }
}

function renderProductImage(form, sourceElement) {
  const builder = form.closest("[data-product-builder]");

  if (!builder) {
    return;
  }

  const changedOption = sourceElement?.selectedOptions?.[0];
  const selectedOption =
    changedOption?.dataset.productImage
    ? changedOption
    : form.querySelector('select[name="_builder_fuel_variant_id"] option:checked');

  if (!selectedOption) {
    return;
  }

  const imageUrl = selectedOption.dataset.productImage;
  const galleryImagesRaw = selectedOption.dataset.galleryImages;
  const mainImage = builder.querySelector("[data-builder-main-image]");
  const gallery = builder.querySelector("[data-builder-gallery]");

  if (mainImage && imageUrl) {
    mainImage.src = imageUrl;
    mainImage.alt = selectedOption.textContent.trim();
  }

  if (gallery && galleryImagesRaw) {
    try {
      const galleryImages = JSON.parse(galleryImagesRaw);
      updateGallery(gallery, galleryImages);
    } catch {
    }
  }
}

function updateGallery(gallery, imageUrls) {
  const existingItems = Array.from(gallery.querySelectorAll("[data-gallery-image]"));

  existingItems.forEach((item, index) => {
    if (index < imageUrls.length) {
      const fullUrl = imageUrls[index];
      const thumbUrl = fullUrl.replace(/width=\d+/i, "width=120");

      item.style.display = "";
      item.dataset.galleryImage = thumbUrl;
      item.dataset.galleryFull = fullUrl;
      const img = item.querySelector("img");
      if (img) {
        img.src = thumbUrl;
        img.loading = "lazy";
      }
      item.classList.toggle("product-builder__gallery-item--active", index === 0);
    } else {
      item.style.display = "none";
    }
  });
}

document.addEventListener("click", (event) => {
  const galleryItem = event.target.closest("[data-gallery-image]");

  if (!galleryItem) {
    return;
  }

  const gallery = galleryItem.closest("[data-builder-gallery]");

  if (!gallery) {
    return;
  }

  const builder = gallery.closest("[data-product-builder]");

  if (!builder) {
    return;
  }

  gallery.querySelectorAll("[data-gallery-image]").forEach((item) => {
    item.classList.remove("product-builder__gallery-item--active");
  });

  galleryItem.classList.add("product-builder__gallery-item--active");

  const fullUrl = galleryItem.dataset.galleryFull || galleryItem.dataset.galleryImage;
  const mainImage = builder.querySelector("[data-builder-main-image]");

  if (mainImage && fullUrl) {
    mainImage.src = fullUrl;
  }
});
