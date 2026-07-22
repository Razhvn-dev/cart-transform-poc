import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  prepareDevCatalogAcceptanceInventoryExecution,
  prepareDevCatalogAcceptanceInventoryMutationScope,
  prepareDevCatalogAcceptanceInventoryReceipt,
} from "./dev-catalog-acceptance-inventory-execution.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const LOCATION_ID = "gid://shopify/Location/113335402774";
const DEV_STORE = "huang-mvqquz1p.myshopify.com";
const planPath = readOption("--plan");
const phase = readOption("--phase");
if (!planPath) throw new Error("--plan is required");
if (!["open", "restore"].includes(phase)) throw new Error("--phase must be open or restore");

const plan = JSON.parse(await readFile(resolve(process.cwd(), planPath), "utf8"));
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "aces-dev-catalog-inventory-window-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: join(root, "node_modules", "@shopify", "cli", "bin", "run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: { appConfig: "shopify.app.dev.toml", store: DEV_STORE, apiVersion: "2026-04" },
  readOnlyAttempts: 8,
  timeoutMs: 60_000,
});

try {
  const before = await readInventory();
  const prepared = prepareDevCatalogAcceptanceInventoryExecution({ plan, phase, observed: before });
  const apply = process.argv.includes("--apply");
  const windowId = readOption("--window-id");
  const mutationScope = windowId == null ? null : prepareDevCatalogAcceptanceInventoryMutationScope({
    planChecksum: plan.checksum,
    phase,
    windowId,
  });
  if (!apply || prepared.status === "already_at_target") {
    process.stdout.write(`${JSON.stringify({
      ...prepared,
      ...(mutationScope ? { window_id: mutationScope.window_id, confirmation: mutationScope.confirmation } : {}),
      mode: apply ? "apply" : "read_only",
      observed: before,
    }, null, 2)}\n`);
  } else {
    if (!mutationScope) throw new Error("--apply requires --window-id");
    if (readOption("--confirm") !== mutationScope.confirmation) {
      throw new Error(`--apply requires --confirm ${mutationScope.confirmation}`);
    }
    const payload = await execute(`#graphql
      mutation SetDevCatalogAcceptanceInventory($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) @idempotent(key: "${stableUuid(mutationScope.idempotency_seed)}") {
          inventoryAdjustmentGroup { createdAt reason }
          userErrors { field message code }
        }
      }
    `, { variables: { input: {
      name: "available",
      reason: "correction",
      referenceDocumentUri: `poc://dev-catalog-acceptance/${mutationScope.reference_path}`,
      quantities: prepared.quantities.map((quantity) => ({ ...quantity, locationId: LOCATION_ID })),
    } } });
    const result = payload.data?.inventorySetQuantities;
    if (result?.userErrors?.length) throw new Error(`inventory mutation rejected: ${JSON.stringify(result.userErrors)}`);
    const after = await readInventory();
    const receipt = prepareDevCatalogAcceptanceInventoryReceipt({ plan, phase, mutationScope, before, after });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function readInventory() {
  const payload = await execute(`#graphql
    query ReadDevCatalogAcceptanceInventory($variantIds: [ID!]!, $locationId: ID!) {
      nodes(ids: $variantIds) {
        ... on ProductVariant {
          id sku inventoryItem {
            id tracked
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available", "on_hand"]) { name quantity }
            }
          }
        }
      }
    }
  `, { variables: { variantIds: plan.operations.map((operation) => operation.variant_gid), locationId: LOCATION_ID } });
  return (payload.data?.nodes ?? []).map((variant) => {
    const quantities = new Map((variant?.inventoryItem?.inventoryLevel?.quantities ?? []).map((item) => [item.name, item.quantity]));
    return {
      sku: variant?.sku,
      variant_gid: variant?.id,
      inventory_item_gid: variant?.inventoryItem?.id,
      tracked: variant?.inventoryItem?.tracked,
      available: quantities.get("available"),
      on_hand: quantities.get("on_hand"),
    };
  });
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
