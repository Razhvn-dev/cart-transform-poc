import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const TARGET = Object.freeze({
  appConfig: "shopify.app.dev.toml",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
  sku: "AF4005PK",
  inventoryItemId: "gid://shopify/InventoryItem/53406931779862",
  locationId: "gid://shopify/Location/113335402774",
});
const requestedQuantity = Number(process.argv.find((argument) => argument.startsWith("--quantity="))?.split("=")[1]);
if (![0, 1].includes(requestedQuantity)) throw new Error("--quantity must be 0 or 1");
const expectedPreviousQuantity = requestedQuantity === 1 ? 0 : 1;
const apply = process.argv.includes("--apply");
const confirmation = `SET-INVENTORY:${TARGET.sku}:${expectedPreviousQuantity}->${requestedQuantity}`;
if (apply && !process.argv.includes(`--confirm=${confirmation}`)) {
  throw new Error(`--apply requires --confirm=${confirmation}`);
}
const idempotencyKey = requestedQuantity === 1
  ? "c99e57fc-cb07-4d08-b048-f2b3f353f935"
  : "27ba2dcb-85ca-4545-a386-85a59f4470ed";

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "aces-af4005pk-inventory-window-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: resolve(root, "node_modules/@shopify/cli/bin/run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: TARGET,
  readOnlyAttempts: 4,
});

try {
  const before = await readInventory();
  if (before.available === requestedQuantity) {
    console.log(JSON.stringify({ status: "already_at_target", target: TARGET, before, confirmation }, null, 2));
  } else if (before.available !== expectedPreviousQuantity) {
    throw new Error(`AF4005PK inventory drift: expected ${expectedPreviousQuantity}, observed ${before.available}`);
  } else if (!apply) {
    console.log(JSON.stringify({ status: "read_only_ready", target: TARGET, before, requestedQuantity, confirmation }, null, 2));
  } else {
    const payload = await execute(`#graphql
      mutation SetAf4005pkParentInventoryWindow($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) @idempotent(key: "${idempotencyKey}") {
          inventoryAdjustmentGroup { createdAt reason }
          userErrors { field message code }
        }
      }
    `, { variables: { input: {
      name: "available",
      reason: "correction",
      referenceDocumentUri: `poc://af4005pk-projection-v59-checkout/${requestedQuantity}`,
      quantities: [{
        inventoryItemId: TARGET.inventoryItemId,
        locationId: TARGET.locationId,
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
    console.log(JSON.stringify({ status: "set_and_verified", target: TARGET, before, after }, null, 2));
  }

  async function readInventory() {
    const payload = await execute(`#graphql
      query ReadAf4005pkParentInventory($id: ID!, $locationId: ID!) {
        node(id: $id) {
          ... on InventoryItem {
            id
            variant { id sku }
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available", "on_hand"]) { name quantity }
            }
          }
        }
      }
    `, { variables: { id: TARGET.inventoryItemId, locationId: TARGET.locationId } });
    const node = payload.data?.node;
    if (node?.variant?.sku !== TARGET.sku) throw new Error("inventory item no longer belongs to AF4005PK");
    const quantities = new Map((node.inventoryLevel?.quantities ?? []).map((item) => [item.name, item.quantity]));
    return { available: quantities.get("available"), on_hand: quantities.get("on_hand") };
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
