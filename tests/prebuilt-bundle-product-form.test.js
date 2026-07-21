import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { createPrebuiltBundleCartMetadata } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-metadata.contract.js";

const ROOT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_PATH = resolve(ROOT_DIRECTORY, "extensions/product-builder/assets/prebuilt-bundle-product-form.js");
const BLOCK_PATH = resolve(ROOT_DIRECTORY, "extensions/product-builder/blocks/prebuilt-bundle-product-form.liquid");
const assetSource = readFileSync(ASSET_PATH, "utf8");
const blockSource = readFileSync(BLOCK_PATH, "utf8");

function loadAsset() {
  const context = {
    globalThis: {
      crypto: { randomUUID: () => "4af6d8b0-0427-49a1-8be7-270bb4132514" },
    },
    Uint8Array,
  };
  vm.runInNewContext(assetSource, context, { filename: ASSET_PATH });
  return context.globalThis.AcesPrebuiltBundleProductForm;
}

const parent = {
  productGid: "gid://shopify/Product/10600519598358",
  variantGid: "gid://shopify/ProductVariant/51505325605142",
  sku: "MASTER-KIT-001",
  title: "Master Kit Test",
};

describe("pre-built Bundle normal-product cart metadata asset", () => {
  it("creates the same strict Bundle Metadata V1 shape as the server contract", () => {
    const asset = loadAsset();
    const bundleInstanceId = "4af6d8b0-0427-49a1-8be7-270bb4132514";

    expect(asset.createCartProperties({ bundleInstanceId, ...parent })).toEqual(
      createPrebuiltBundleCartMetadata({
        bundle_instance_id: bundleInstanceId,
        parent: {
          product_gid: parent.productGid,
          variant_gid: parent.variantGid,
          sku: parent.sku,
          title: parent.title,
        },
      }).properties,
    );
    expect(asset.PROPERTY_KEYS).toEqual([
      "_bundle_id",
      "_bundle_schema_version",
      "_parent_product_gid",
      "_parent_variant_gid",
      "_parent_sku",
      "_parent_title",
    ]);
  });

  it("rejects malformed parent identity instead of injecting metadata", () => {
    const asset = loadAsset();

    expect(asset.createCartProperties({ bundleInstanceId: "instance", ...parent })).toBeNull();
    expect(asset.createCartProperties({ ...parent, bundleInstanceId: "instance", variantGid: "bad" })).toBeNull();
  });

  it("creates a new UUID for every normal product add", () => {
    const asset = loadAsset();
    const ids = [
      asset.createBundleInstanceId({ randomUUID: () => "4af6d8b0-0427-49a1-8be7-270bb4132514" }),
      asset.createBundleInstanceId({ randomUUID: () => "bfc2c6e6-1600-4f48-9fd8-d2018e080ec3" }),
    ];

    expect(ids).toEqual([
      "4af6d8b0-0427-49a1-8be7-270bb4132514",
      "bfc2c6e6-1600-4f48-9fd8-d2018e080ec3",
    ]);
  });

  it("does not bind to the isolated Builder form", () => {
    const asset = loadAsset();
    expect(asset.shouldIgnoreForm({
      matches: (selector) => selector === "[data-product-builder-form]",
      closest: () => null,
    })).toBe(true);
    expect(asset.shouldIgnoreForm({
      matches: () => false,
      closest: (selector) => selector === "[data-product-builder]" ? {} : null,
    })).toBe(true);
  });

  it("accepts only one pre-built bundle instance per native form submit", () => {
    const asset = loadAsset();
    const quantity = (value) => ({ querySelector: () => ({ value }) });
    const externalQuantity = (value, formId = "native-product-form") => ({
      value,
      getAttribute: (attribute) => attribute === "form" ? formId : null,
    });
    const nativeDawnForm = {
      id: "native-product-form",
      elements: { namedItem: () => null },
      querySelector: () => null,
    };

    expect(asset.readRequestedQuantity({ querySelector: () => null })).toBe(1);
    expect(asset.readRequestedQuantity(quantity("1"))).toBe(1);
    expect(asset.readRequestedQuantity(quantity("2"))).toBe(2);
    expect(asset.readRequestedQuantity(nativeDawnForm, {
      querySelectorAll: () => [externalQuantity("2")],
    })).toBe(2);
    expect(asset.readRequestedQuantity(nativeDawnForm, {
      querySelectorAll: () => [externalQuantity("2", "another-form")],
    })).toBe(1);
    expect(asset.readRequestedQuantity({
      elements: { namedItem: () => ({ value: "2" }) },
      querySelector: () => null,
    })).toBe(2);
    expect(asset.readRequestedQuantity(quantity("0"))).toBeNull();
    expect(asset.readRequestedQuantity(quantity("1.5"))).toBeNull();
  });

  it("prevents the native Dawn form submit when its externally associated quantity is not one", () => {
    const asset = loadAsset();
    const quantityInput = {
      value: "2",
      getAttribute: (attribute) => attribute === "form" ? "native-product-form" : null,
    };
    const error = { hidden: true };
    const form = {
      id: "native-product-form",
      elements: { namedItem: () => quantityInput },
      matches: () => false,
      closest: () => null,
      querySelector: (selector) => {
        if (selector === '[name="id"]') return { value: "51505325605142" };
        if (selector === "[data-prebuilt-bundle-quantity-error]") return error;
        return null;
      },
      prepend: () => {},
    };
    const marker = {
      dataset: { quantityError: "Pre-built bundles must be added one at a time." },
      querySelector: () => ({
        textContent: JSON.stringify({
          51505325605142: { variantGid: parent.variantGid, sku: parent.sku },
        }),
      }),
    };
    const documentRoot = {
      querySelectorAll: (selector) => {
        if (selector === '[name="quantity"][form]') return [quantityInput];
        if (selector === "[data-prebuilt-bundle-product-form]") return [marker];
        return [];
      },
    };
    const event = {
      target: form,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    asset.attachMetadataOnSubmit(event, documentRoot);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();

    const clickEvent = {
      target: { closest: () => ({ form }) },
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    asset.interceptNativeAddToCartClick(clickEvent, documentRoot);

    expect(clickEvent.preventDefault).toHaveBeenCalledOnce();
    expect(clickEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("writes Metadata V1 during the capture-phase native add-to-cart click", () => {
    const asset = loadAsset();
    const hiddenInputs = new Map();
    const form = {
      id: "native-product-form",
      elements: { namedItem: () => null },
      matches: () => false,
      closest: () => null,
      querySelector: (selector) => {
        if (selector === '[name="id"]') return { value: "51505325605142" };
        if (selector === '[name="quantity"]') return { value: "1" };
        if (selector === "[data-prebuilt-bundle-quantity-error]") return null;
        const propertyName = selector.match(/^\[name="(.+)"\]$/)?.[1];
        return propertyName ? hiddenInputs.get(propertyName) ?? null : null;
      },
      append: (input) => hiddenInputs.set(input.name, input),
    };
    const marker = {
      dataset: {
        parentProductGid: parent.productGid,
        parentTitle: parent.title,
        quantityError: "Pre-built bundles must be added one at a time.",
      },
      querySelector: () => ({
        textContent: JSON.stringify({
          51505325605142: { variantGid: parent.variantGid, sku: parent.sku },
        }),
      }),
    };
    const documentRoot = {
      createElement: () => ({}),
      querySelectorAll: (selector) => selector === "[data-prebuilt-bundle-product-form]" ? [marker] : [],
    };
    const event = {
      target: { closest: () => ({ form }) },
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    asset.interceptNativeAddToCartClick(event, documentRoot);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(Object.fromEntries([...hiddenInputs].map(([name, input]) => [name, input.value]))).toEqual({
      "properties[_bundle_id]": "4af6d8b0-0427-49a1-8be7-270bb4132514",
      "properties[_bundle_schema_version]": "1",
      "properties[_parent_product_gid]": parent.productGid,
      "properties[_parent_variant_gid]": parent.variantGid,
      "properties[_parent_sku]": parent.sku,
      "properties[_parent_title]": parent.title,
    });
  });

  it("contains no component, selection, price, mapping, or Snapshot authority fields", () => {
    expect(assetSource).not.toMatch(/component_variant|fixed_selection|snapshot_checksum|runtime_snapshot|mapping_id|price_cents/i);
  });

  it("uses block placement as the only opt-in, stays Shopify-schema-compatible, and is isolated from the Builder template", () => {
    expect(blockSource).toContain('{% if product != blank %}');
    expect(blockSource).toContain('"name": "Prebuilt bundle metadata"');
    expect(blockSource).not.toContain('block.settings.enabled');
    expect(blockSource).not.toContain('"settings"');
    expect(blockSource).toContain('"javascript": "prebuilt-bundle-product-form.js"');
    expect(blockSource).not.toContain("<script src=");
    expect(blockSource).toContain("data-quantity-error");
    expect(blockSource).not.toContain("data-product-builder");
    expect(blockSource).not.toMatch(/fixed_selection|component_variant|snapshot_checksum|price_cents/i);
  });
});
