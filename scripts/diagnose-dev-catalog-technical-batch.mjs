import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";
import { executeDevCatalogTechnicalBatchQuery } from "./dev-catalog-technical-batch-query.js";
import { assessDevCatalogTechnicalBatchLiveReadback, collectTechnicalBatchSkus } from "./dev-catalog-technical-batch-live-readback.js";

const TARGET = Object.freeze({ appConfig: "shopify.app.dev.toml", store: "huang-mvqquz1p.myshopify.com", apiVersion: "2026-04" });
const INVENTORY_LOCATION_ID = "gid://shopify/Location/113335402774";
if (process.argv.includes("--session-transport")) {
  throw new Error("session transport is disabled until trusted app identity is available");
}
const options = parseArguments(process.argv.slice(2));
const root = resolve(import.meta.dirname, "..");
const [catalogReport, scope] = await Promise.all([readJson(options.inputPath), readJson(options.scopePath)]);
const skus = collectTechnicalBatchSkus(catalogReport, scope);
const directory = await mkdtemp(join(tmpdir(), "aces-dev-catalog-batch-readback-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: resolve(root, "node_modules/@shopify/cli/bin/run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: TARGET,
});
try {
  const queryText = skus.map((sku) => `sku:${escapeSearchValue(sku)}`).join(" OR ");
  const readback = await executeDevCatalogTechnicalBatchQuery({
    execute,
    queryText,
    locationId: INVENTORY_LOCATION_ID,
  });
  const report = {
    ...assessDevCatalogTechnicalBatchLiveReadback({
    catalogReport,
    scope,
    liveVariants: readback.nodes,
    }),
    inventory_readback: readback.inventory_readback,
  };
  if (options.outputPath) {
    await writeFile(resolve(root, options.outputPath), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.summary.blocked > 0 ? 1 : 0;
} finally {
  await rm(directory, { recursive: true, force: true });
}

function parseArguments(args) {
  const options = { inputPath: null, scopePath: null, outputPath: null };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (key === "--session-transport") {
      throw new Error("session transport is disabled until trusted app identity is available");
    }
    const value = args[index + 1];
    if (["--apply", "--write", "--execute"].includes(key)) throw new Error("this diagnostic is read-only");
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument "${key}"`);
    if (key === "--input") options.inputPath = value;
    else if (key === "--scope") options.scopePath = value;
    else if (key === "--output") options.outputPath = value;
    else throw new Error(`unsupported argument "${key}"`);
    index += 2;
  }
  if (!options.inputPath || !options.scopePath) throw new Error("usage: provide --input and --scope");
  return options;
}

function escapeSearchValue(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}
