import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { analyzeNativeBundleCompatibility } from "./native-bundle-compatibility.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const TARGET = Object.freeze({
  appConfig: "shopify.app.dev.toml",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
});

const productGid = requiredProductGid(process.argv.slice(2));
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "aces-native-bundle-diagnostic-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: resolve(root, "node_modules/@shopify/cli/bin/run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: TARGET,
});

try {
  const response = await execute(`#graphql
    query DiagnoseNativeBundleCompatibility($productId: ID!) {
      product(id: $productId) {
        id
        title
        combinedListingRole
        variants(first: 250) {
          nodes {
            id
            title
            sku
            requiresComponents
            productVariantComponents(first: 30) {
              nodes { id quantity productVariant { id title sku } }
            }
          }
        }
      }
    }
  `, { variables: { productId: productGid } });
  console.log(JSON.stringify({ target: TARGET, assessment: analyzeNativeBundleCompatibility(response.data.product) }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

function requiredProductGid(args) {
  if (args.some((arg) => ["--apply", "--write", "--execute", "--unlink"].includes(arg))) {
    throw new Error("This diagnostic is read-only and rejects mutation flags");
  }
  const index = args.indexOf("--product-id");
  const value = index >= 0 ? args[index + 1] : null;
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(value ?? "")) {
    throw new Error("usage: npm run diagnose:native-bundle-conflicts:dev-read-only -- --product-id gid://shopify/Product/<id>");
  }
  return value;
}
