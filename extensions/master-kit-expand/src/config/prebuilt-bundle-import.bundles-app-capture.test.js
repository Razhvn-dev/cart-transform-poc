import { describe, expect, it } from "vitest";

import {
  analyzeBundlesAppCapturePrices,
  BUNDLES_APP_SOURCE_SYSTEM,
  normalizeBundlesAppCapture,
} from "./prebuilt-bundle-import.bundles-app-capture.js";

const csv = [
  "sku,title,product_id,variant_id,type,status",
  'BUNDLE-1,"Bundle, Gold",100,200,BUNDLE,active',
  "PART-A,Part A,101,201,,active",
  "PART-B,Part B,102,202,,active",
].join("\r\n");

const capture = {
  schema_version: "bundles_app_manual_capture.v1",
  source_bundle_id: "200",
  product_series_key: "gold-kit",
  parent_sku: "BUNDLE-1",
  components: [
    { sku: "PART-A", quantity: 1 },
    { sku: "PART-B", quantity: 1 },
  ],
};

const productCsv = [
  "Handle,Title,Variant SKU,Variant Price,Variant Compare At Price",
  "bundle,Bundle,BUNDLE-1,70.00,100.00",
  "part-a,Part A,PART-A,40.00,50.00",
  "part-b,Part B,PART-B,60.00,70.00",
].join("\r\n");

describe("Bundles.app manual relationship capture", () => {
  it("resolves the Variant CSV into a canonical, write-free source record", () => {
    const result = normalizeBundlesAppCapture({ variant_csv_text: csv, capture_document: capture });

    expect(result).toMatchObject({
      source_export: {
        source_system: BUNDLES_APP_SOURCE_SYSTEM,
        collection_mode: "bundles_app_variant_csv_plus_manual_relationship_capture",
        record_count: 1,
      },
      source_records: [{
        schema_version: "prebuilt_bundle_import_source.v1",
        source_system: BUNDLES_APP_SOURCE_SYSTEM,
        source_bundle_id: "200",
        product_series_key: "gold-kit",
        parent_binding: {
          product_gid: "gid://shopify/Product/100",
          variant_gid: "gid://shopify/ProductVariant/200",
        },
        components: [
          { variant_gid: "gid://shopify/ProductVariant/201", quantity: 1 },
          { variant_gid: "gid://shopify/ProductVariant/202", quantity: 1 },
        ],
      }],
    });
    expect(result.source_records[0].source_checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("fails closed for missing, ambiguous, nested Bundle, or unsupported quantity inputs", () => {
    expect(() => normalizeBundlesAppCapture({
      variant_csv_text: csv,
      capture_document: { ...capture, parent_sku: "MISSING" },
    })).toThrow("was not found");

    expect(() => normalizeBundlesAppCapture({
      variant_csv_text: `${csv}\r\nPART-A,Duplicate,103,203,,active`,
      capture_document: capture,
    })).toThrow("appears 2 times");

    expect(() => normalizeBundlesAppCapture({
      variant_csv_text: csv,
      capture_document: { ...capture, components: [{ sku: "BUNDLE-1", quantity: 1 }] },
    })).toThrow("another BUNDLE");

    expect(() => normalizeBundlesAppCapture({
      variant_csv_text: csv,
      capture_document: { ...capture, components: [{ sku: "PART-A", quantity: 2 }] },
    })).toThrow("must equal 1");
  });

  it("reconciles Shopify prices and produces an exact evidence-only allocation", () => {
    const result = analyzeBundlesAppCapturePrices({
      product_csv_text: productCsv,
      capture_document: {
        ...capture,
        price_summary: {
          expected_component_total_cents: 10000,
          expected_bundle_price_cents: 7000,
        },
      },
    });

    expect(result).toMatchObject({
      schema_version: "bundles_app_price_evidence.v1",
      component_subtotal_cents: 10000,
      bundle_price_cents: 7000,
      discount_cents: 3000,
      discount_percentage: "30.00",
      allocation_method: "proportional_to_variant_price_with_delta_to_last",
      components: [
        { sku: "PART-A", variant_price_cents: 4000, allocated_price_cents: 2800 },
        { sku: "PART-B", variant_price_cents: 6000, allocated_price_cents: 4200 },
      ],
      allocation_total_cents: 7000,
    });
  });

  it("fails closed when captured totals do not reconcile", () => {
    expect(() => analyzeBundlesAppCapturePrices({
      product_csv_text: productCsv,
      capture_document: {
        ...capture,
        price_summary: {
          expected_component_total_cents: 9999,
          expected_bundle_price_cents: 7000,
        },
      },
    })).toThrow("does not match captured value");
  });
});
