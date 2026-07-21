import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import ExcelJS from "exceljs";

import {
  preflightBundlesAppCatalog,
} from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.bundles-app-catalog.js";

export function parseBundlesAppCatalogArguments(args) {
  const options = { xlsxPath: null, variantsCsvPath: null, outputPath: null, summaryOnly: false };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (["--apply", "--write", "--execute", "--shopify"].includes(key)) {
      throw new Error("this command is a local preflight and cannot write to Shopify");
    }
    if (key === "--summary") {
      options.summaryOnly = true;
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument "${key}"`);
    if (key === "--xlsx") options.xlsxPath = value;
    else if (key === "--variants-csv") options.variantsCsvPath = value;
    else if (key === "--output") options.outputPath = value;
    else throw new Error(`unsupported argument "${key}"`);
    index += 2;
  }
  if (!options.xlsxPath || !options.variantsCsvPath) {
    throw new Error("usage: node scripts/preflight-bundles-app-catalog.mjs --xlsx <sku_pricing.xlsx> --variants-csv <variants.csv> [--summary] [--output <report.json>]");
  }
  return options;
}

export function extractBundlesAppRelationshipRows(workbook) {
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Bundles.app workbook has no worksheets");
  const headerRow = worksheet.getRow(1);
  const headers = [];
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    headers.push(cellText(headerRow.getCell(column)).trim());
  }
  const normalizedHeaders = headers.map(normalizeHeader);
  const column = (name) => normalizedHeaders.indexOf(normalizeHeader(name)) + 1;
  const columns = {
    productTitle: column("Product Title"),
    variantName: column("Variant Name"),
    sku: column("SKU"),
    bundleContents: column("Bundle Contents"),
  };
  const missing = Object.entries(columns).filter(([, index]) => index === 0).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Bundles.app workbook is missing columns: ${missing.join(", ")}`);

  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const bundleContents = cellText(row.getCell(columns.bundleContents)).trim();
    if (!bundleContents || ["—", "-", "n/a"].includes(bundleContents.toLowerCase())) continue;
    rows.push({
      excel_row: rowNumber,
      product_title: cellText(row.getCell(columns.productTitle)).trim(),
      variant_name: cellText(row.getCell(columns.variantName)).trim(),
      sku: cellText(row.getCell(columns.sku)).trim(),
      bundle_contents: bundleContents,
    });
  }
  if (rows.length === 0) throw new Error("Bundles.app workbook contains no Bundle Contents rows");
  return rows;
}

export function summarizeBundlesAppCatalogPreflight(report, outputPath = null) {
  const blockers = report.records
    .filter((record) => record.status === "rejected")
    .slice(0, 20)
    .map((record) => ({
      parent_sku: record.parent_sku,
      source_rows: record.source_rows.map((row) => row.excel_row),
      issue_codes: [...new Set(record.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code))],
    }));
  return {
    schema_version: report.schema_version,
    mode: report.mode,
    source_export: report.source_export,
    summary: report.summary,
    blocker_examples: blockers,
    output_path: outputPath,
  };
}

async function main() {
  const options = parseBundlesAppCatalogArguments(process.argv.slice(2));
  const [variantCsvText, workbook] = await Promise.all([
    readFile(resolve(process.cwd(), options.variantsCsvPath), "utf8"),
    loadWorkbook(resolve(process.cwd(), options.xlsxPath)),
  ]);
  const report = preflightBundlesAppCatalog({
    relationship_rows: extractBundlesAppRelationshipRows(workbook),
    variant_csv_text: variantCsvText,
  });
  let resolvedOutput = null;
  if (options.outputPath) {
    resolvedOutput = resolve(process.cwd(), options.outputPath);
    await writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
  const value = options.summaryOnly || resolvedOutput
    ? summarizeBundlesAppCatalogPreflight(report, resolvedOutput)
    : report;
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function loadWorkbook(path) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}

function cellText(cell) {
  if (typeof cell?.text === "string") return cell.text;
  const value = cell?.value;
  if (value == null) return "";
  if (typeof value === "object" && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text ?? "").join("");
  }
  if (typeof value === "object" && "result" in value) return String(value.result ?? "");
  return String(value);
}

function normalizeHeader(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
