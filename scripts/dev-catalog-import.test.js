import { describe, expect, it } from "vitest";

import { bindExistingIds, buildSourceCatalog, createDevCatalogPlan, fingerprintText, isVerifiedImportedProduct } from "./dev-catalog-import.js";

describe("development catalogue import", () => {
  it("normalizes multi-variant Shopify CSV rows and disables native bundle authority", () => {
    const products = buildSourceCatalog([
      row({ Handle: "kit", Title: "Kit", "Option1 Name": "Color", "Option1 Value": "Black", "Variant SKU": "KIT-B", "Variant Price": "10.00", Status: "active" }, 2),
      row({ Handle: "kit", "Option1 Value": "Gold", "Variant SKU": "KIT-G", "Variant Price": "12.00" }, 3),
    ]);
    expect(products).toHaveLength(1);
    expect(products[0].input.productOptions).toEqual([{ name: "Color", position: 1, values: [{ name: "Black" }, { name: "Gold" }] }]);
    expect(products[0].input.variants[1]).toMatchObject({ sku: "KIT-G", inventoryPolicy: "CONTINUE", requiresComponents: false });
    expect(bindExistingIds(products[0], null).variants[0]).not.toHaveProperty("source_row");
  });

  it("preserves runtime products and binds existing variants by SKU", () => {
    const products = buildSourceCatalog([row({ Handle: "real", Title: "Real", "Option1 Name": "Title", "Option1 Value": "Default Title", "Variant SKU": "REAL-1", "Variant Price": "10.00", Status: "active" }, 2)]);
    const existing = [
      { id: "gid://shopify/Product/1", handle: "master-kit-test", title: "Master Kit Test", variants: { nodes: [] } },
      { id: "gid://shopify/Product/2", handle: "obsolete", title: "Obsolete", variants: { nodes: [] } },
      { id: "gid://shopify/Product/3", handle: "real", title: "Real old", variants: { nodes: [{ id: "gid://shopify/ProductVariant/9", sku: "REAL-1" }] } },
    ];
    const plan = createDevCatalogPlan({ products, existingProducts: existing, sourceFingerprint: fingerprintText("csv") });
    expect(plan.summary).toMatchObject({ creates: 0, updates: 1, cleanup_deletes: 1, runtime_preserved: 1 });
    expect(plan.cleanup[0].handle).toBe("obsolete");
    expect(bindExistingIds(products[0], existing[2]).variants[0].id).toBe("gid://shopify/ProductVariant/9");
    expect(isVerifiedImportedProduct(products[0], { ...existing[2], variantsCount: { count: 1 } })).toBe(true);
  });
});

function row(overrides, rowNumber) {
  return {
    Handle: "", Title: "", "Body (HTML)": "", Vendor: "", Type: "", Tags: "", Status: "draft", "Gift Card": "false",
    "Option1 Name": "", "Option1 Value": "", "Option2 Name": "", "Option2 Value": "", "Option3 Name": "", "Option3 Value": "",
    "Variant SKU": "", "Variant Barcode": "", "Variant Price": "", "Variant Compare At Price": "", "Variant Requires Shipping": "true",
    "Variant Taxable": "true", "Cost per item": "", "SEO Title": "", "SEO Description": "", "Image Src": "", "Variant Image": "",
    __row_number: rowNumber,
    ...overrides,
  };
}
