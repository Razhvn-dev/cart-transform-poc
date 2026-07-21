import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  extractBundlesAppRelationshipRows,
  parseBundlesAppCatalogArguments,
  summarizeBundlesAppCatalogPreflight,
} from "./preflight-bundles-app-catalog.mjs";

describe("Bundles.app catalogue preflight CLI", () => {
  it("accepts local inputs and rejects Shopify mutations", () => {
    expect(parseBundlesAppCatalogArguments([
      "--xlsx", "sku_pricing.xlsx",
      "--variants-csv", "variants.csv",
      "--summary",
      "--output", ".local/report.json",
    ])).toEqual({
      xlsxPath: "sku_pricing.xlsx",
      variantsCsvPath: "variants.csv",
      outputPath: ".local/report.json",
      summaryOnly: true,
    });
    expect(() => parseBundlesAppCatalogArguments(["--apply"])).toThrow("cannot write to Shopify");
    expect(() => parseBundlesAppCatalogArguments(["--xlsx", "source.xlsx"])).toThrow("usage");
  });

  it("extracts only rows with Bundle Contents from an ExcelJS workbook", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("SKU Data");
    sheet.addRow(["Product Title", "Variant Name", "SKU", "Bundle Contents"]);
    sheet.addRow(["Part", "Default", "PART-A", "—"]);
    sheet.addRow(["Bundle", "Default", "BUNDLE-1", "PART-A x1\n(In Stock)"]);

    expect(extractBundlesAppRelationshipRows(workbook)).toEqual([{
      excel_row: 3,
      product_title: "Bundle",
      variant_name: "Default",
      sku: "BUNDLE-1",
      bundle_contents: "PART-A x1\n(In Stock)",
    }]);
  });

  it("creates a compact blocker summary without changing the full report", () => {
    const report = {
      schema_version: "bundles_app_catalog_preflight.v1",
      mode: "read_only",
      source_export: { relationship_row_count: 1 },
      summary: { rejected: 1 },
      records: [{
        parent_sku: "BUNDLE-1",
        status: "rejected",
        source_rows: [{ excel_row: 8 }],
        issues: [{ code: "BLOCKED", severity: "error" }],
      }],
    };
    expect(summarizeBundlesAppCatalogPreflight(report, "report.json")).toMatchObject({
      blocker_examples: [{ parent_sku: "BUNDLE-1", source_rows: [8], issue_codes: ["BLOCKED"] }],
      output_path: "report.json",
    });
  });
});
