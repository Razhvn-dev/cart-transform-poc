import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Produces a Shopify-write-free SKU mapping candidate from the Bundles.app
 * preflight report and the CSV that was imported into the development store.
 * Handles are evidence only: no Shopify GID or Bundle Admin target is inferred.
 */
export function prepareDevCatalogTargetMapping({ preflight, productCsvText } = {}) {
  if (preflight?.schema_version !== "bundles_app_catalog_preflight.v1") {
    throw new Error("preflight must be a bundles_app_catalog_preflight.v1 report");
  }
  if (!Array.isArray(preflight.records)) throw new Error("preflight.records must be an array");

  const sourceRows = parseCsv(productCsvText);
  const catalog = indexCatalogRows(sourceRows);
  const candidates = preflight.records
    .filter((record) => record.status === "ready_for_mapping")
    .map((record) => mapRecord(record, catalog))
    .sort((left, right) => left.parent_sku.localeCompare(right.parent_sku));
  const statusCounts = countBy(candidates, (candidate) => candidate.status);

  return deepFreeze({
    schema_version: "dev_catalog_target_mapping_candidates.v1",
    mode: "local_only",
    source: {
      preflight_schema_version: preflight.schema_version,
      preflight_relationship_fingerprint: preflight.source_export?.relationship_fingerprint ?? null,
      preflight_variant_catalog_fingerprint: preflight.source_export?.variant_catalog_fingerprint ?? null,
      imported_catalog_rows: sourceRows.length,
      imported_catalog_skus: catalog.size,
    },
    summary: {
      input_ready_for_mapping: candidates.length,
      ready_for_target_binding: statusCounts.ready_for_target_binding ?? 0,
      missing_catalog_sku: statusCounts.missing_catalog_sku ?? 0,
      ambiguous_catalog_sku: statusCounts.ambiguous_catalog_sku ?? 0,
      shopify_writes_performed: false,
    },
    candidates,
  });
}

export function parseDevCatalogMappingArguments(args) {
  const options = { preflightPath: null, productCsvPath: null, outputPath: null, summaryOnly: false };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (["--apply", "--write", "--execute", "--shopify"].includes(key)) {
      throw new Error("this command is local-only and cannot write to Shopify");
    }
    if (key === "--summary") {
      options.summaryOnly = true;
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument "${key}"`);
    if (key === "--preflight") options.preflightPath = value;
    else if (key === "--products-csv") options.productCsvPath = value;
    else if (key === "--output") options.outputPath = value;
    else throw new Error(`unsupported argument "${key}"`);
    index += 2;
  }
  if (!options.preflightPath || !options.productCsvPath) {
    throw new Error("usage: node scripts/prepare-dev-catalog-target-mapping.mjs --preflight <report.json> --products-csv <products.csv> [--summary] [--output <new-report.json>]");
  }
  return options;
}

export function summarizeDevCatalogTargetMapping(result, outputPath = null) {
  return {
    schema_version: result.schema_version,
    mode: result.mode,
    source: result.source,
    summary: result.summary,
    blocker_examples: result.candidates
      .filter((candidate) => candidate.status !== "ready_for_target_binding")
      .slice(0, 20)
      .map(({ parent_sku, status, unresolved_skus }) => ({ parent_sku, status, unresolved_skus })),
    output_path: outputPath,
  };
}

function mapRecord(record, catalog) {
  const parent = resolveSku(catalog, record.parent_sku, "parent");
  const components = record.components.map((component) => resolveSku(catalog, component.sku, "component"));
  const unresolved = [parent, ...components].filter((item) => item.status !== "resolved");
  const statuses = new Set(unresolved.map((item) => item.status));
  const status = statuses.has("ambiguous")
    ? "ambiguous_catalog_sku"
    : statuses.has("missing")
      ? "missing_catalog_sku"
      : "ready_for_target_binding";
  return {
    parent_sku: record.parent_sku,
    source_checksum: record.source_checksum,
    status,
    parent: parent.status === "resolved" ? parent.catalog : { sku: record.parent_sku, status: parent.status },
    components: components.map((component, index) => component.status === "resolved"
      ? { ...component.catalog, quantity: record.components[index].quantity }
      : { sku: record.components[index].sku, quantity: record.components[index].quantity, status: component.status }),
    unresolved_skus: unresolved.map(({ sku, role, status: unresolvedStatus }) => ({ sku, role, status: unresolvedStatus })),
  };
}

function resolveSku(catalog, sku, role) {
  const entries = catalog.get(sku) ?? [];
  if (entries.length === 0) return { sku, role, status: "missing" };
  if (entries.length > 1) return { sku, role, status: "ambiguous" };
  return { sku, role, status: "resolved", catalog: entries[0] };
}

function indexCatalogRows(rows) {
  const index = new Map();
  rows.forEach((row) => {
    const sku = text(row["Variant SKU"]);
    if (!sku) return;
    const entry = {
      sku,
      handle: text(row.Handle),
      product_title: text(row.Title),
      variant_title: variantTitle(row),
      price: text(row["Variant Price"]),
      compare_at_price: text(row["Variant Compare At Price"]),
      product_status: text(row.Status),
      published: text(row.Published),
    };
    const entries = index.get(sku) ?? [];
    if (!entries.some((existing) => JSON.stringify(existing) === JSON.stringify(entry))) entries.push(entry);
    index.set(sku, entries);
  });
  return index;
}

function variantTitle(row) {
  return [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]]
    .map(text)
    .filter(Boolean)
    .join(" / ");
}

function parseCsv(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("products CSV must be non-empty text");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (char === '"' && value[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && value[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("products CSV has an unclosed quoted field");
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  const [headers, ...data] = rows;
  if (!headers?.includes("Variant SKU") || !headers.includes("Handle")) {
    throw new Error("products CSV must contain Handle and Variant SKU columns");
  }
  return data.filter((cells) => cells.some((item) => item !== "")).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function countBy(values, key) {
  return values.reduce((counts, value) => {
    const name = key(value);
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

async function main() {
  const options = parseDevCatalogMappingArguments(process.argv.slice(2));
  const [preflightText, productCsvText] = await Promise.all([
    readFile(resolve(process.cwd(), options.preflightPath), "utf8"),
    readFile(resolve(process.cwd(), options.productCsvPath), "utf8"),
  ]);
  const result = prepareDevCatalogTargetMapping({ preflight: JSON.parse(preflightText), productCsvText });
  let outputPath = null;
  if (options.outputPath) {
    outputPath = resolve(process.cwd(), options.outputPath);
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
  const output = options.summaryOnly || outputPath ? summarizeDevCatalogTargetMapping(result, outputPath) : result;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
