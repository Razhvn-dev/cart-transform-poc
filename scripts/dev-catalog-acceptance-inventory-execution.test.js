import { describe, expect, it } from "vitest";

import { calculateStableValueChecksum } from "../extensions/master-kit-expand/src/config/bundle-runtime.checksum.js";
import {
  prepareDevCatalogAcceptanceInventoryExecution,
  prepareDevCatalogAcceptanceInventoryMutationScope,
  prepareDevCatalogAcceptanceInventoryReceipt,
} from "./dev-catalog-acceptance-inventory-execution.js";

function plan() {
  const body = {
    schema_version: "dev_catalog_acceptance_inventory_plan.v1",
    mode: "local_plan_only",
    store_domain: "huang-mvqquz1p.myshopify.com",
    batch_id: "batch-2",
    operations: [operation("A"), operation("B")],
    no_action: [],
    blockers: [],
    complete: true,
    shopify_writes_performed: false,
  };
  return { ...body, checksum: calculateStableValueChecksum(body) };
}

function operation(sku) {
  return {
    sku,
    role: "component",
    variant_gid: `gid://shopify/ProductVariant/${sku}`,
    inventory_item_gid: `gid://shopify/InventoryItem/${sku}`,
    status: "window_required",
    open: { expected_available: 0, expected_on_hand: 0, quantity: 1 },
    restore: { expected_available: 1, expected_on_hand: 1, quantity: 0 },
  };
}

function observed(sku, available, onHand = available) {
  return {
    sku,
    variant_gid: `gid://shopify/ProductVariant/${sku}`,
    inventory_item_gid: `gid://shopify/InventoryItem/${sku}`,
    tracked: true,
    available,
    on_hand: onHand,
  };
}

describe("development catalogue acceptance inventory execution", () => {
  it("requires a fresh stable window id for each acceptance cycle", () => {
    const first = prepareDevCatalogAcceptanceInventoryMutationScope({
      planChecksum: "d1aa061a",
      phase: "open",
      windowId: "theme-readback-1",
    });
    const retry = prepareDevCatalogAcceptanceInventoryMutationScope({
      planChecksum: "d1aa061a",
      phase: "open",
      windowId: "theme-readback-1",
    });
    const next = prepareDevCatalogAcceptanceInventoryMutationScope({
      planChecksum: "d1aa061a",
      phase: "open",
      windowId: "theme-readback-2",
    });

    expect(retry).toEqual(first);
    expect(next.idempotency_seed).not.toBe(first.idempotency_seed);
    expect(first.confirmation).toBe("APPLY_DEV_INVENTORY_WINDOW:d1aa061a:open:theme-readback-1");
    expect(() => prepareDevCatalogAcceptanceInventoryMutationScope({
      planChecksum: "d1aa061a",
      phase: "open",
    })).toThrow(/window id/i);
  });

  it("binds a verified mutation receipt to the exact inventory window", () => {
    const input = plan();
    const mutationScope = prepareDevCatalogAcceptanceInventoryMutationScope({
      planChecksum: input.checksum,
      phase: "restore",
      windowId: "v63-projection-fix-1",
    });
    const before = [observed("A", 1), observed("B", 1)];
    const after = [observed("A", 0), observed("B", 0)];

    expect(prepareDevCatalogAcceptanceInventoryReceipt({
      plan: input,
      phase: "restore",
      mutationScope,
      before,
      after,
    })).toMatchObject({
      status: "set_and_verified",
      phase: "restore",
      plan_checksum: input.checksum,
      window_id: "v63-projection-fix-1",
      confirmation: `APPLY_DEV_INVENTORY_WINDOW:${input.checksum}:restore:v63-projection-fix-1`,
      reference_path: `${input.checksum}/v63-projection-fix-1/restore`,
      shopify_writes_performed: true,
      before,
      after,
    });
  });

  it("rejects a receipt whose before state does not match the planned transition", () => {
    const input = plan();
    const mutationScope = prepareDevCatalogAcceptanceInventoryMutationScope({
      planChecksum: input.checksum,
      phase: "restore",
      windowId: "restore-drift-1",
    });

    expect(() => prepareDevCatalogAcceptanceInventoryReceipt({
      plan: input,
      phase: "restore",
      mutationScope,
      before: [observed("A", 4), observed("B", 1)],
      after: [observed("A", 0), observed("B", 0)],
    })).toThrow(/before read-back/i);
  });

  it("prepares an exact open mutation only after every baseline is verified", () => {
    const input = plan();
    const result = prepareDevCatalogAcceptanceInventoryExecution({
      plan: input,
      phase: "open",
      observed: [observed("A", 0), observed("B", 0)],
    });

    expect(result.status).toBe("ready_to_apply");
    expect(result.shopify_writes_performed).toBe(false);
    expect(result.confirmation).toBe(`APPLY_DEV_INVENTORY_WINDOW:${input.checksum}:open`);
    expect(result.quantities).toEqual([
      { inventoryItemId: "gid://shopify/InventoryItem/A", quantity: 1, changeFromQuantity: 0 },
      { inventoryItemId: "gid://shopify/InventoryItem/B", quantity: 1, changeFromQuantity: 0 },
    ]);
  });

  it("resumes safely when one target already reached the requested value", () => {
    const result = prepareDevCatalogAcceptanceInventoryExecution({
      plan: plan(),
      phase: "open",
      observed: [observed("A", 1), observed("B", 0)],
    });

    expect(result.status).toBe("ready_to_apply");
    expect(result.already_at_target).toEqual(["A"]);
    expect(result.quantities).toEqual([
      { inventoryItemId: "gid://shopify/InventoryItem/B", quantity: 1, changeFromQuantity: 0 },
    ]);
  });

  it("fails closed for identity drift, quantity drift, or a modified plan", () => {
    expect(() => prepareDevCatalogAcceptanceInventoryExecution({
      plan: plan(),
      phase: "restore",
      observed: [observed("A", 1), { ...observed("B", 1), inventory_item_gid: "gid://shopify/InventoryItem/WRONG" }],
    })).toThrow(/identity drift/i);

    expect(() => prepareDevCatalogAcceptanceInventoryExecution({
      plan: plan(),
      phase: "open",
      observed: [observed("A", 0), observed("B", 3)],
    })).toThrow(/quantity drift/i);

    const changed = plan();
    changed.operations[0].sku = "CHANGED";
    expect(() => prepareDevCatalogAcceptanceInventoryExecution({
      plan: changed,
      phase: "open",
      observed: [observed("A", 0), observed("B", 0)],
    })).toThrow(/checksum/i);
  });
});
