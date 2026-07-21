import { describe, expect, it } from "vitest";

import {
  parseBundlesAppRelationshipCell,
  preflightBundlesAppCatalog,
} from "./prebuilt-bundle-import.bundles-app-catalog.js";

const variants = [
  "sku,title,product_id,variant_id,type,status",
  "BUNDLE-1,Bundle 1,100,200,BUNDLE,active",
  "BUNDLE-2,Bundle 2,101,201,BUNDLE,active",
  "BUNDLE-3,Bundle 3,105,205,BUNDLE,active",
  "BUNDLE-4,Bundle 4,106,206,BUNDLE,active",
  "PART-A,Part A,102,202,,active",
  "PART-B,Part B,103,203,,active",
  "NESTED,Nested,104,204,BUNDLE,active",
].join("\r\n");

function row(overrides = {}) {
  return {
    excel_row: 2,
    product_title: "Bundle 1",
    variant_name: "Default",
    sku: "BUNDLE-1",
    bundle_contents: "PART-A x1\n(In Stock)\nPART-B x1\n(Out of Stock)",
    ...overrides,
  };
}

describe("Bundles.app full-catalogue preflight", () => {
  it("parses stock annotations without treating them as components", () => {
    expect(parseBundlesAppRelationshipCell("PART-A x1\n(In Stock)\nPART-B x2\n(Out of Stock)")).toEqual([
      { sku: "PART-A", quantity: 1 },
      { sku: "PART-B", quantity: 2 },
    ]);
  });

  it("resolves a complete quantity-one relationship without creating target mappings", () => {
    const result = preflightBundlesAppCatalog({ relationship_rows: [row()], variant_csv_text: variants });

    expect(result).toMatchObject({
      schema_version: "bundles_app_catalog_preflight.v1",
      mode: "read_only",
      summary: {
        relationship_rows: 1,
        unique_parent_skus: 1,
        ready_for_mapping: 1,
        rejected: 0,
        target_mapping_required: true,
        shopify_writes_performed: false,
      },
      records: [{
        parent_sku: "BUNDLE-1",
        status: "ready_for_mapping",
        parent_binding: {
          product_gid: "gid://shopify/Product/100",
          variant_gid: "gid://shopify/ProductVariant/200",
        },
        components: [
          { sku: "PART-A", quantity: 1, variant_gid: "gid://shopify/ProductVariant/202" },
          { sku: "PART-B", quantity: 1, variant_gid: "gid://shopify/ProductVariant/203" },
        ],
      }],
    });
    expect(result.records[0].source_checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("deduplicates identical Combined Listing rows but rejects conflicting relationships", () => {
    const exact = preflightBundlesAppCatalog({
      relationship_rows: [
        row({ excel_row: 2, product_title: "Standalone" }),
        row({ excel_row: 3, product_title: "Combined Listing" }),
      ],
      variant_csv_text: variants,
    });
    expect(exact.summary).toMatchObject({ unique_parent_skus: 1, duplicate_parent_skus: 1, ready_for_mapping: 1 });
    expect(exact.records[0].issues).toContainEqual(expect.objectContaining({
      code: "EXACT_DUPLICATE_PARENT_SKU",
      severity: "warning",
    }));

    const conflict = preflightBundlesAppCatalog({
      relationship_rows: [
        row({ excel_row: 2 }),
        row({ excel_row: 3, bundle_contents: "PART-A x1" }),
      ],
      variant_csv_text: variants,
    });
    expect(conflict.summary).toMatchObject({ ready_for_mapping: 0, rejected: 1 });
    expect(conflict.records[0].issues).toContainEqual(expect.objectContaining({
      code: "CONFLICTING_DUPLICATE_RELATIONSHIP",
      severity: "error",
    }));
  });

  it("classifies quantities, missing identities, ambiguous identities, and nested Bundles", () => {
    const ambiguousVariants = `${variants}\r\nPART-A,Duplicate Part A,999,999,,active`;
    const result = preflightBundlesAppCatalog({
      relationship_rows: [
        row({ sku: "BUNDLE-2", bundle_contents: "PART-B x8" }),
        row({ excel_row: 3, bundle_contents: "PART-A x1" }),
        row({ excel_row: 4, sku: "BUNDLE-3", bundle_contents: "MISSING x1" }),
        row({ excel_row: 5, sku: "BUNDLE-4", bundle_contents: "NESTED x1" }),
      ],
      variant_csv_text: ambiguousVariants,
    });
    const codes = result.records.flatMap((record) => record.issues.map((issue) => issue.code));
    expect(codes).toEqual(expect.arrayContaining([
      "UNSUPPORTED_COMPONENT_QUANTITY",
      "AMBIGUOUS_COMPONENT_VARIANT",
      "COMPONENT_SKU_NOT_FOUND",
      "NESTED_BUNDLE_UNSUPPORTED",
    ]));
    expect(result.summary.rejected).toBeGreaterThan(0);
  });

  it("fails closed on malformed or duplicate component lines", () => {
    expect(() => parseBundlesAppRelationshipCell("PART-A 1")).toThrow("unsupported line");
    expect(() => parseBundlesAppRelationshipCell("PART-A x1\nPART-A x1")).toThrow("repeats component SKU");
  });
});
