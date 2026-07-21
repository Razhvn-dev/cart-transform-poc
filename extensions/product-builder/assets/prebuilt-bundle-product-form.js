/* global globalThis */

(() => {
  const PROPERTY_KEYS = Object.freeze([
    "_bundle_id",
    "_bundle_schema_version",
    "_parent_product_gid",
    "_parent_variant_gid",
    "_parent_sku",
    "_parent_title",
  ]);
  const PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/\d+$/;
  const PRODUCT_VARIANT_GID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function createBundleInstanceId(cryptoApi = globalThis.crypto) {
    if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
    if (typeof cryptoApi?.getRandomValues !== "function") return null;

    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function createCartProperties({ bundleInstanceId, productGid, variantGid, sku, title } = {}) {
    if (typeof bundleInstanceId !== "string" || !UUID_PATTERN.test(bundleInstanceId)) return null;
    if (typeof productGid !== "string" || !PRODUCT_GID_PATTERN.test(productGid)) return null;
    if (typeof variantGid !== "string" || !PRODUCT_VARIANT_GID_PATTERN.test(variantGid)) return null;

    return {
      _bundle_id: bundleInstanceId,
      _bundle_schema_version: "1",
      _parent_product_gid: productGid,
      _parent_variant_gid: variantGid,
      _parent_sku: typeof sku === "string" ? sku : "",
      _parent_title: typeof title === "string" ? title : "",
    };
  }

  function writeCartProperties(form, properties, documentRoot = document) {
    if (!form || !properties) return;

    PROPERTY_KEYS.forEach((key) => {
      const name = `properties[${key}]`;
      let input = form.querySelector(`[name="${name}"]`);
      if (!input) {
        input = documentRoot.createElement("input");
        input.type = "hidden";
        input.name = name;
        form.append(input);
      }
      input.value = properties[key];
    });
  }

  function readVariantMetadata(marker, variantId) {
    const payload = marker.querySelector("[data-prebuilt-bundle-variant-map]");
    if (!payload || !variantId) return null;

    try {
      const variants = JSON.parse(payload.textContent);
      const variant = variants[String(variantId)];
      if (!variant || typeof variant !== "object") return null;
      return variant;
    } catch {
      return null;
    }
  }

  function shouldIgnoreForm(form) {
    return !form
      || form.matches("[data-product-builder-form]")
      || Boolean(form.closest("[data-product-builder]"));
  }

  function readRequestedQuantity(form, documentRoot) {
    const root = documentRoot
      ?? form?.ownerDocument
      ?? (typeof document !== "undefined" ? document : null);
    const nestedInput = form?.querySelector('[name="quantity"]');
    const formAssociatedInput = form?.elements?.namedItem?.("quantity");
    const associatedInput = form?.id && typeof root?.querySelectorAll === "function"
      ? [...root.querySelectorAll('[name="quantity"][form]')]
        .find((input) => input.getAttribute?.("form") === form.id)
      : null;
    const value = (nestedInput ?? formAssociatedInput ?? associatedInput)?.value;
    if (value == null || value === "") return 1;
    const quantity = Number(value);
    return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
  }

  function showQuantityError(form, message, documentRoot = document) {
    let error = form.querySelector("[data-prebuilt-bundle-quantity-error]");
    if (!error) {
      error = documentRoot.createElement("p");
      error.dataset.prebuiltBundleQuantityError = "";
      error.setAttribute("role", "alert");
      form.prepend(error);
    }
    error.textContent = message || "Pre-built bundles must be added one at a time.";
    error.hidden = false;
  }

  function clearQuantityError(form) {
    const error = form?.querySelector("[data-prebuilt-bundle-quantity-error]");
    if (error) error.hidden = true;
  }

  function findPrebuiltVariant(form, documentRoot = document) {
    if (shouldIgnoreForm(form)) return null;

    const variantId = form.querySelector('[name="id"]')?.value;
    if (!variantId) return null;

    for (const marker of documentRoot.querySelectorAll("[data-prebuilt-bundle-product-form]")) {
      const variant = readVariantMetadata(marker, variantId);
      if (variant) return { marker, variant };
    }
    return null;
  }

  function blockInvalidQuantity(event, form, prebuilt, documentRoot = document) {
    if (readRequestedQuantity(form, documentRoot) === 1) return false;

    event.preventDefault();
    event.stopImmediatePropagation?.();
    showQuantityError(form, prebuilt.marker.dataset.quantityError, documentRoot);
    return true;
  }

  function attachMetadataOnSubmit(event, documentRoot = document) {
    const form = event.target;
    const prebuilt = findPrebuiltVariant(form, documentRoot);
    if (!prebuilt || blockInvalidQuantity(event, form, prebuilt, documentRoot)) return;

    attachMetadataToForm(form, prebuilt, documentRoot);
  }

  function attachMetadataToForm(form, prebuilt, documentRoot = document) {
    const properties = createCartProperties({
      bundleInstanceId: createBundleInstanceId(),
      productGid: prebuilt.marker.dataset.parentProductGid,
      variantGid: prebuilt.variant.variantGid,
      sku: prebuilt.variant.sku,
      title: prebuilt.marker.dataset.parentTitle,
    });
    writeCartProperties(form, properties, documentRoot);
    clearQuantityError(form);
  }

  function interceptNativeAddToCartClick(event, documentRoot = document) {
    const submitter = event.target?.closest?.('button[type="submit"][name="add"]');
    const form = submitter?.form;
    const prebuilt = findPrebuiltVariant(form, documentRoot);
    if (!prebuilt || blockInvalidQuantity(event, form, prebuilt, documentRoot)) return;

    // Dawn serializes the form through its AJAX cart handler immediately after
    // this capture-phase click listener. Write Metadata V1 here as well as on
    // submit so the properties exist before Dawn constructs that request.
    attachMetadataToForm(form, prebuilt, documentRoot);
  }

  const api = Object.freeze({
    PROPERTY_KEYS,
    attachMetadataToForm,
    attachMetadataOnSubmit,
    blockInvalidQuantity,
    createBundleInstanceId,
    createCartProperties,
    clearQuantityError,
    readRequestedQuantity,
    readVariantMetadata,
    findPrebuiltVariant,
    interceptNativeAddToCartClick,
    showQuantityError,
    shouldIgnoreForm,
    writeCartProperties,
  });

  globalThis.AcesPrebuiltBundleProductForm = api;

  if (typeof document !== "undefined" && !globalThis.__acesPrebuiltBundleProductFormBound) {
    globalThis.__acesPrebuiltBundleProductFormBound = true;
    document.addEventListener("click", (event) => interceptNativeAddToCartClick(event), true);
    document.addEventListener("submit", (event) => attachMetadataOnSubmit(event), true);
  }
})();
