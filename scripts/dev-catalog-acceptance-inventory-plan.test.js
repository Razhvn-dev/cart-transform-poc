import { describe, expect, it } from "vitest";

import { planDevCatalogAcceptanceInventoryWindows } from "./dev-catalog-acceptance-inventory-plan.js";

function target(sku, { role = "component", available = 0, onHand = available, sellable = available, policy = "DENY", tracked = true } = {}) {
  return {
    sku,
    role,
    live: {
      variant_gid: `gid://shopify/ProductVariant/${sku}`,
      inventory_item_gid: `gid://shopify/InventoryItem/${sku}`,
      inventory_tracked: tracked,
      inventory_policy: policy,
      sellable_online_quantity: sellable,
      inventory_available: available,
      inventory_on_hand: onHand,
    },
  };
}

function readback(parent, components) {
  return {
    schema_version: "dev_catalog_technical_batch_live_readback.v2",
    store_domain: "huang-mvqquz1p.myshopify.com",
    batch_id: "batch-2",
    records: [{ parent, components }],
  };
}

describe("development catalogue acceptance inventory planning", () => {
  it("plans exact reversible zero-to-one windows and preserves already sellable inventory", () => {
    const result = planDevCatalogAcceptanceInventoryWindows({
      liveReadback: readback(target("PARENT", { role: "parent" }), [target("ZERO"), target("READY", { available: 5 })]),
    });

    expect(result.complete).toBe(true);
    expect(result.operations.map((item) => item.sku)).toEqual(["PARENT", "ZERO"]);
    expect(result.operations[0]).toMatchObject({ open: { expected_available: 0, quantity: 1 }, restore: { expected_available: 1, quantity: 0 } });
    expect(result.no_action[0]).toMatchObject({ sku: "READY", reason: "ALREADY_SELLABLE" });
    expect(result.shopify_writes_performed).toBe(false);
  });

  it("fails closed for drifted or untracked inventory baselines", () => {
    const result = planDevCatalogAcceptanceInventoryWindows({
      liveReadback: readback(target("PARENT", { role: "parent", available: -1, onHand: 0 }), [target("UNTRACKED", { tracked: false })]),
    });

    expect(result.complete).toBe(false);
    expect(result.blockers.map((item) => item.reason)).toEqual([
      "UNSAFE_INVENTORY_BASELINE",
      "INVENTORY_IDENTITY_OR_TRACKING_UNAVAILABLE",
    ]);
    expect(result.operations).toEqual([]);
  });

  it("deduplicates a shared component by exact live Variant identity", () => {
    const shared = target("SHARED", { available: 2 });
    const result = planDevCatalogAcceptanceInventoryWindows({
      liveReadback: {
        ...readback(target("PARENT-1", { role: "parent", available: 2 }), [shared]),
        records: [
          { parent: target("PARENT-1", { role: "parent", available: 2 }), components: [shared] },
          { parent: target("PARENT-2", { role: "parent", available: 2 }), components: [structuredClone(shared)] },
        ],
      },
    });

    expect(result.no_action.filter((item) => item.sku === "SHARED")).toHaveLength(1);
  });
});
