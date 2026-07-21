import { describe, expect, it } from "vitest";

import {
  parseDevCatalogMappingArguments,
  prepareDevCatalogTargetMapping,
  summarizeDevCatalogTargetMapping,
} from "./prepare-dev-catalog-target-mapping.mjs";

const preflight = {
  schema_version: "bundles_app_catalog_preflight.v1",
  source_export: { relationship_fingerprint: "relationships", variant_catalog_fingerprint: "variants" },
  records: [{
    parent_sku: "BUNDLE-1",
    source_checksum: "source",
    status: "ready_for_mapping",
    components: [{ sku: "PART-1", quantity: 1 }],
  }],
};

describe("development catalogue target mapping preparation", () => {
  it("maps SKU-only candidates locally without creating Shopify targets", () => {
    const result = prepareDevCatalogTargetMapping({
      preflight,
      productCsvText: "Handle,Title,Option1 Value,Variant SKU,Variant Price,Status\nkit,Kit,Default Title,BUNDLE-1,100.00,active\npart,Part,Default Title,PART-1,5.00,active\n",
    });
    expect(result.summary).toMatchObject({ input_ready_for_mapping: 1, ready_for_target_binding: 1, shopify_writes_performed: false });
    expect(result.candidates[0]).toMatchObject({
      status: "ready_for_target_binding",
      parent: { sku: "BUNDLE-1", handle: "kit", price: "100.00" },
      components: [{ sku: "PART-1", quantity: 1, handle: "part" }],
    });
  });

  it("reports missing and ambiguous source SKUs without guessing", () => {
    const missing = prepareDevCatalogTargetMapping({
      preflight,
      productCsvText: "Handle,Variant SKU\nkit,BUNDLE-1\n",
    });
    expect(missing.candidates[0]).toMatchObject({ status: "missing_catalog_sku", unresolved_skus: [{ sku: "PART-1", role: "component", status: "missing" }] });

    const ambiguous = prepareDevCatalogTargetMapping({
      preflight,
      productCsvText: "Handle,Variant SKU\nkit-a,BUNDLE-1\nkit-b,BUNDLE-1\npart,PART-1\n",
    });
    expect(ambiguous.candidates[0]).toMatchObject({ status: "ambiguous_catalog_sku", unresolved_skus: [{ sku: "BUNDLE-1", role: "parent", status: "ambiguous" }] });
  });

  it("rejects write flags and summarizes blockers", () => {
    expect(() => parseDevCatalogMappingArguments(["--apply"])).toThrow("cannot write to Shopify");
    const result = prepareDevCatalogTargetMapping({ preflight, productCsvText: "Handle,Variant SKU\nkit,BUNDLE-1\n" });
    expect(summarizeDevCatalogTargetMapping(result, ".local/result.json")).toMatchObject({
      blocker_examples: [{ parent_sku: "BUNDLE-1", status: "missing_catalog_sku" }],
      output_path: ".local/result.json",
    });
  });
});
