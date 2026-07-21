#!/usr/bin/env node
/**
 * Development-store-only inventory repair for the three components used by the
 * hosted prebuilt-bundle probe. It never touches the parent SKU or production.
 *
 * Usage:
 *   node scripts/repair-dev-prebuilt-component-inventory.mjs
 *   node scripts/repair-dev-prebuilt-component-inventory.mjs --execute
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TARGET = Object.freeze({
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
  locationName: "Shop location",
  locationId: "gid://shopify/Location/113335402774",
  quantity: 10,
  inventoryItemIds: [
    "gid://shopify/InventoryItem/53406931747094", // AF4005P
    "gid://shopify/InventoryItem/53406977556758", // AF2009P
    "gid://shopify/InventoryItem/53406990696726", // AC2008
  ],
});
const execute = process.argv.includes("--execute");
const directory = mkdtempSync(join(tmpdir(), "aces-prebuilt-component-inventory-"));

function runStoreOperation(query, variables = {}, allowMutations = false) {
  const outputFile = join(directory, `response-${Math.random().toString(16).slice(2)}.json`);
  const args = [
    resolve(import.meta.dirname, "../node_modules/@shopify/cli/bin/run.js"),
    "app", "execute",
    "--config", "shopify.app.dev.toml",
    "--store", TARGET.store,
    "--version", TARGET.apiVersion,
    "--query", query,
    "--variables", JSON.stringify(variables),
    "--output-file", outputFile,
    "--no-color",
  ];
  execFileSync(process.execPath, args, { encoding: "utf8", cwd: resolve(import.meta.dirname, "..") });
  return JSON.parse(readFileSync(outputFile, "utf8"));
}

try {
  const quantities = TARGET.inventoryItemIds.map((inventoryItemId) => ({
    inventoryItemId,
    locationId: TARGET.locationId,
    quantity: TARGET.quantity,
    // Read and verified as zero immediately before this controlled write.
    // Shopify rejects the mutation if any value changes in the meantime.
    changeFromQuantity: 0,
  }));

  if (!execute) {
    console.log(JSON.stringify({ mode: "dry-run", target: TARGET, quantities }, null, 2));
    process.exit(0);
  }

  const result = runStoreOperation(`mutation SetComponentAvailability($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) @idempotent(key: "7ee25a4e-6f61-4690-a889-ae6e43e7ef84") {
      inventoryAdjustmentGroup { createdAt reason }
      userErrors { field message }
    }
  }`, {
    input: {
      name: "available",
      reason: "correction",
      referenceDocumentUri: "poc://prebuilt-bundle-live-component-repair",
      quantities,
    },
  }, true);
  const payload = result.inventorySetQuantities;
  if (payload?.userErrors?.length) throw new Error(JSON.stringify(payload.userErrors));

  const readBack = runStoreOperation(`query ComponentReadBack($ids: [ID!]!) {
    nodes(ids: $ids) {
      id
      ... on InventoryItem {
          inventoryLevel(locationId: "${TARGET.locationId}") {
          quantities(names: ["available"]) { name quantity }
        }
      }
    }
  }`, { ids: quantities.map((item) => item.inventoryItemId) });
  const available = readBack.nodes?.map((item) => item?.inventoryLevel?.quantities?.find((quantity) => quantity.name === "available")?.quantity);
  if (available?.some((quantity) => quantity !== TARGET.quantity)) {
    throw new Error(`Inventory read-back failed: ${JSON.stringify(readBack.nodes)}.`);
  }

  console.log(JSON.stringify({ mode: "executed", target: TARGET, quantities, available }, null, 2));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
