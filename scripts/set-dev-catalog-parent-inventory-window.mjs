import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const INVENTORY_TARGETS = Object.freeze({
  "AD2011-C": "gid://shopify/ProductVariant/51592633811222",
  "AD2023-C": "gid://shopify/ProductVariant/51592633647382",
  "AD2023": "gid://shopify/ProductVariant/51592722088214",
});
const LOCATION_ID = "gid://shopify/Location/113335402774";
const sku = readOption("--sku");
const variantId = INVENTORY_TARGETS[sku];
if (!variantId) throw new Error("--sku must be AD2011-C, AD2023-C, or AD2023");
const requestedQuantity = Number(readOption("--quantity"));
if (![0, 1].includes(requestedQuantity)) throw new Error("--quantity must be 0 or 1");
const expectedPreviousQuantity = requestedQuantity === 1 ? 0 : 1;
const confirmation = `SET-INVENTORY:${sku}:${expectedPreviousQuantity}->${requestedQuantity}`;
const apply = process.argv.includes("--apply");
if (apply && readOption("--confirm") !== confirmation) throw new Error(`--apply requires --confirm ${confirmation}`);

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
  const before = await readInventory();
  if (before.available === requestedQuantity && before.on_hand === requestedQuantity) {
    process.stdout.write(`${JSON.stringify({ status: "already_at_target", sku, variantId, before }, null, 2)}\n`);
  } else if (before.available !== expectedPreviousQuantity || before.on_hand !== expectedPreviousQuantity) {
    throw new Error(`${sku} inventory drift: expected ${expectedPreviousQuantity}/${expectedPreviousQuantity}, observed ${before.available}/${before.on_hand}`);
  } else if (!apply) {
    process.stdout.write(`${JSON.stringify({ status: "read_only_ready", sku, variantId, before, requestedQuantity, confirmation }, null, 2)}\n`);
  } else {
    const inventoryItemId = before.inventory_item_id;
    const payload = await execute(`#graphql
      mutation SetDevCatalogTestInventory($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) @idempotent(key: "${stableUuid(`${sku}:${expectedPreviousQuantity}->${requestedQuantity}`)}") {
          inventoryAdjustmentGroup { createdAt reason }
          userErrors { field message code }
        }
      }
    `, { variables: { input: {
      name: "available",
      reason: "correction",
      referenceDocumentUri: `poc://dev-catalog-technical-batch/${sku}/${requestedQuantity}`,
      quantities: [{
        inventoryItemId,
        locationId: LOCATION_ID,
        quantity: requestedQuantity,
        changeFromQuantity: expectedPreviousQuantity,
      }],
    } } });
    const result = payload.data?.inventorySetQuantities;
    if (result?.userErrors?.length) throw new Error(`inventory mutation rejected: ${JSON.stringify(result.userErrors)}`);
    const after = await readInventory();
    if (after.available !== requestedQuantity || after.on_hand !== requestedQuantity) {
      throw new Error(`inventory read-back mismatch: ${JSON.stringify(after)}`);
    }
    process.stdout.write(`${JSON.stringify({ status: "set_and_verified", sku, variantId, before, after }, null, 2)}\n`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function readInventory() {
  const payload = await execute(`#graphql
    query ReadDevCatalogTestInventory($variantId: ID!, $locationId: ID!) {
      productVariant(id: $variantId) {
        id sku title selectedOptions { name value } sellableOnlineQuantity inventoryPolicy inventoryItem {
          id tracked
          inventoryLevel(locationId: $locationId) {
            quantities(names: ["available", "on_hand"]) { name quantity }
          }
        }
      }
    }
  `, { variables: { variantId, locationId: LOCATION_ID } });
  const variant = payload.data?.productVariant;
  if (variant?.id !== variantId || variant?.sku !== sku || variant.inventoryItem?.tracked !== true) {
    throw new Error("inventory target identity or tracked state drift");
  }
  const quantities = new Map((variant.inventoryItem.inventoryLevel?.quantities ?? []).map((item) => [item.name, item.quantity]));
  return {
    inventory_item_id: variant.inventoryItem.id,
    variant_title: variant.title,
    selected_options: variant.selectedOptions,
    sellable_online_quantity: variant.sellableOnlineQuantity,
    inventory_policy: variant.inventoryPolicy,
    available: quantities.get("available"),
    on_hand: quantities.get("on_hand"),
  };
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function stableUuid(seed) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
