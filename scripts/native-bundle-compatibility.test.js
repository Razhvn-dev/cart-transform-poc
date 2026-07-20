import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeNativeBundleCompatibility } from "./native-bundle-compatibility.js";

describe("native bundle compatibility", () => {
  it("rejects Combined Listing and native bundle overlap", () => {
    expect(analyzeNativeBundleCompatibility(product({
      combinedListingRole: "PARENT",
      requiresComponents: true,
      components: [{ id: "gid://shopify/ProductVariantComponent/1" }],
    }))).toMatchObject({
      status: "needs_owner_app_cleanup",
      native_bundle_conflict_free: false,
      issues: [
        { code: "COMBINED_LISTING_NATIVE_BUNDLE_CONFLICT" },
        { code: "REQUIRES_COMPONENTS_ENABLED" },
        { code: "NATIVE_COMPONENT_RELATIONSHIPS_PRESENT" },
      ],
    });
  });

  it("accepts a Combined Listing with no native bundle state", () => {
    expect(analyzeNativeBundleCompatibility(product({ combinedListingRole: "CHILD" })))
      .toMatchObject({ status: "native_bundle_conflict_free", native_bundle_conflict_free: true, issues: [] });
  });

  it("keeps the product seed path free of native bundle writes and mutation retries", async () => {
    const source = await readFile(resolve("scripts/seed-test-products.mjs"), "utf8");
    expect(source).not.toContain("productVariantRelationshipBulkUpdate");
    expect(source).not.toContain("requiresComponents: true");
    expect(source).not.toContain("removeAllProductVariantRelationships");
    expect(source).toContain("const attempts = allowMutations ? 1 : 3");
  });
});

function product({ combinedListingRole = null, requiresComponents = false, components = [] } = {}) {
  return {
    id: "gid://shopify/Product/1",
    title: "Compatibility test",
    combinedListingRole,
    variants: {
      nodes: [{
        id: "gid://shopify/ProductVariant/1",
        title: "Default",
        sku: "TEST-1",
        requiresComponents,
        productVariantComponents: { nodes: components },
      }],
    },
  };
}
