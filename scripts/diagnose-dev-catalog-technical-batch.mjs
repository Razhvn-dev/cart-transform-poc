import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

import { DEV_SHOPIFY_APP_CLIENT_ID } from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";
import { createShopifySessionAdminExecutor } from "./shopify-session-admin-executor.js";
import { assessDevCatalogTechnicalBatchLiveReadback, collectTechnicalBatchSkus } from "./dev-catalog-technical-batch-live-readback.js";

const TARGET = Object.freeze({ appConfig: "shopify.app.dev.toml", store: "huang-mvqquz1p.myshopify.com", apiVersion: "2026-04" });
const INVENTORY_LOCATION_ID = "gid://shopify/Location/113335402774";
const options = parseArguments(process.argv.slice(2));
const root = resolve(import.meta.dirname, "..");
const [catalogReport, scope] = await Promise.all([readJson(options.inputPath), readJson(options.scopePath)]);
const skus = collectTechnicalBatchSkus(catalogReport, scope);
const directory = await mkdtemp(join(tmpdir(), "aces-dev-catalog-batch-readback-"));
let prisma = null;
let execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: resolve(root, "node_modules/@shopify/cli/bin/run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: TARGET,
});
try {
  if (options.sessionTransport) {
    const credentials = parseEnvFile(await readFile(resolve(root, ".env.docker"), "utf8"));
    if (credentials.SHOPIFY_API_KEY !== DEV_SHOPIFY_APP_CLIENT_ID) {
      throw new Error("local credentials do not belong to cart-transform-poc-dev");
    }
    prisma = new PrismaClient();
    execute = createShopifySessionAdminExecutor({
      prisma,
      shop: TARGET.store,
      apiVersion: TARGET.apiVersion,
      clientId: credentials.SHOPIFY_API_KEY,
      clientSecret: credentials.SHOPIFY_API_SECRET,
    });
  }
  const queryText = skus.map((sku) => `sku:${escapeSearchValue(sku)}`).join(" OR ");
  const payload = await execute(`#graphql
    query DevCatalogTechnicalBatchReadback($query: String!, $locationId: ID!) {
      productVariants(first: 100, query: $query) {
        nodes {
          id
          sku
          price
          compareAtPrice
          sellableOnlineQuantity
          inventoryPolicy
          inventoryItem {
            id
            tracked
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available", "on_hand"]) { name quantity }
            }
          }
          product { id handle title status onlineStoreUrl }
        }
      }
    }
  `, { variables: { query: queryText, locationId: INVENTORY_LOCATION_ID } });
  const report = assessDevCatalogTechnicalBatchLiveReadback({
    catalogReport,
    scope,
    liveVariants: payload.data?.productVariants?.nodes ?? [],
  });
  if (options.outputPath) {
    await writeFile(resolve(root, options.outputPath), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.summary.blocked > 0 ? 1 : 0;
} finally {
  await prisma?.$disconnect();
  await rm(directory, { recursive: true, force: true });
}

function parseArguments(args) {
  const options = { inputPath: null, scopePath: null, outputPath: null, sessionTransport: false };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (key === "--session-transport") {
      options.sessionTransport = true;
      index += 1;
      continue;
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

function parseEnvFile(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return [];
    const separator = trimmed.indexOf("=");
    if (separator < 1) return [];
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[key, value]];
  }));
}
