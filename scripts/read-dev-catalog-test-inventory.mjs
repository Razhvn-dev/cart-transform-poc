import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const VARIANT_IDS = Object.freeze([
  "gid://shopify/ProductVariant/51592633811222", // AD2011-C
  "gid://shopify/ProductVariant/51592633647382", // AD2023-C
  "gid://shopify/ProductVariant/51592728903958", // AD2011
  "gid://shopify/ProductVariant/51592722088214", // AD2023
  "gid://shopify/ProductVariant/51592730706198", // AC2008
]);
const LOCATION_ID = "gid://shopify/Location/113335402774";
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "aces-dev-catalog-test-inventory-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: join(root, "node_modules", "@shopify", "cli", "bin", "run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: { appConfig: "shopify.app.dev.toml", store: "huang-mvqquz1p.myshopify.com", apiVersion: "2026-04" },
  readOnlyAttempts: 8,
  timeoutMs: 60_000,
});

try {
  const response = await execute(`#graphql
    query ReadDevCatalogTestInventory($ids: [ID!]!, $locationId: ID!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id sku title sellableOnlineQuantity
          inventoryItem {
            id tracked
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available", "on_hand"]) { name quantity }
            }
          }
        }
      }
    }
  `, { variables: { ids: VARIANT_IDS, locationId: LOCATION_ID } });
  const records = response.data.nodes.map((variant) => ({
    variant_id: variant.id,
    sku: variant.sku,
    title: variant.title,
    inventory_item_id: variant.inventoryItem?.id,
    tracked: variant.inventoryItem?.tracked,
    sellable_online_quantity: variant.sellableOnlineQuantity,
    quantities: Object.fromEntries((variant.inventoryItem?.inventoryLevel?.quantities ?? []).map((item) => [item.name, item.quantity])),
  }));
  if (records.some((record) => !record.variant_id || record.tracked !== true)) throw new Error("catalogue inventory read-back is incomplete");
  process.stdout.write(`${JSON.stringify({
    schema_version: "dev_catalog_test_inventory_readback.v1",
    captured_at: new Date().toISOString(),
    store_domain: "huang-mvqquz1p.myshopify.com",
    location_id: LOCATION_ID,
    shopify_writes_performed: false,
    records,
  }, null, 2)}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
