import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import {
  BUILDER_STANDARD_COMPONENTS,
  BUILDER_STANDARD_INVENTORY_READBACK_SCHEMA_VERSION,
  RUST_HYBRID_ACCEPTANCE_BATCH_ID,
  RUST_HYBRID_ACCEPTANCE_WINDOW_ID,
  buildRustHybridAcceptanceExecutorArguments,
  planRustHybridAcceptanceInventory,
} from "./rust-hybrid-acceptance-inventory.js";

const STORE = "huang-mvqquz1p.myshopify.com";
const CURRENT_BUILDER_VARIANTS = Object.freeze({
  efi: "gid://shopify/ProductVariant/51592538587414",
  fuel: "gid://shopify/ProductVariant/51505348346134",
  ignition: "gid://shopify/ProductVariant/51592730706198",
});
const RETIRED_BUILDER_VARIANTS = Object.freeze({
  efi: "gid://shopify/ProductVariant/51552319766806",
  ignition: "gid://shopify/ProductVariant/51552321011990",
});
const PARENTS = Object.freeze({
  "AS2014B-BT": "gid://shopify/ProductVariant/51592723333398",
  "AS2014B2-FK-4005P": "gid://shopify/ProductVariant/51592541503766",
  "AS2014B2-MK-2011-4005P": "gid://shopify/ProductVariant/51592577089814",
});

function liveComponent({
  sku,
  variantId,
  inventoryItemId = variantId.replace("ProductVariant", "InventoryItem"),
  policy = "DENY",
  available = 0,
  onHand = 0,
  sellable = 0,
  tracked = true,
} = {}) {
  return {
    sku,
    role: "component",
    live: {
      variant_gid: variantId,
      inventory_item_gid: inventoryItemId,
      inventory_tracked: tracked,
      inventory_policy: policy,
      inventory_available: available,
      inventory_on_hand: onHand,
      sellable_online_quantity: sellable,
    },
  };
}

function catalogReadback(overrides = {}) {
  const shared = liveComponent({
    sku: "AC2008",
    variantId: BUILDER_STANDARD_COMPONENTS.ignition.variant_gid,
    available: 4,
    onHand: 5,
    sellable: 4,
  });
  return {
    schema_version: "dev_catalog_technical_batch_live_readback.v2",
    mode: "shopify_admin_read_only",
    store_domain: STORE,
    batch_id: "large-component-breadth-acceptance-v1",
    records: [
      {
        parent_sku: "AS2014B-BT",
        parent: {
          sku: "AS2014B-BT",
          role: "parent",
          live: { variant_gid: PARENTS["AS2014B-BT"] },
        },
        components: [
          liveComponent({ sku: "AZ0004", variantId: "gid://shopify/ProductVariant/1001" }),
          liveComponent({
            sku: "AZ0010",
            variantId: "gid://shopify/ProductVariant/1002",
            policy: "CONTINUE",
          }),
        ],
      },
      {
        parent_sku: "AS2014B2-FK-4005P",
        parent: {
          sku: "AS2014B2-FK-4005P",
          role: "parent",
          live: { variant_gid: PARENTS["AS2014B2-FK-4005P"] },
        },
        components: [
          liveComponent({ sku: "AZ0004", variantId: "gid://shopify/ProductVariant/1001" }),
          liveComponent({
            sku: "AF4005P",
            variantId: "gid://shopify/ProductVariant/1003",
            available: 2,
            onHand: 2,
            sellable: 2,
          }),
        ],
      },
      {
        parent_sku: "AS2014B2-MK-2011-4005P",
        parent: {
          sku: "AS2014B2-MK-2011-4005P",
          role: "parent",
          live: { variant_gid: PARENTS["AS2014B2-MK-2011-4005P"] },
        },
        components: [
          shared,
          liveComponent({
            sku: "parent-must-never-be-selected",
            variantId: PARENTS["AS2014B-BT"],
          }),
        ],
      },
    ],
    shopify_writes_performed: false,
    ...overrides,
  };
}

function builderReadback(overrides = {}) {
  return {
    schema_version: BUILDER_STANDARD_INVENTORY_READBACK_SCHEMA_VERSION,
    mode: "shopify_admin_read_only",
    store_domain: STORE,
    records: [
      liveComponent({
        sku: BUILDER_STANDARD_COMPONENTS.efi.sku,
        variantId: BUILDER_STANDARD_COMPONENTS.efi.variant_gid,
      }),
      liveComponent({
        sku: BUILDER_STANDARD_COMPONENTS.fuel.sku,
        variantId: BUILDER_STANDARD_COMPONENTS.fuel.variant_gid,
      }),
      liveComponent({
        sku: BUILDER_STANDARD_COMPONENTS.ignition.sku,
        variantId: BUILDER_STANDARD_COMPONENTS.ignition.variant_gid,
        available: 4,
        onHand: 5,
        sellable: 4,
      }),
    ],
    shopify_writes_performed: false,
    ...overrides,
  };
}

describe("Rust hybrid hosted acceptance inventory planning", () => {
  test("locks current Builder identities and never emits retired Variant records", () => {
    expect(BUILDER_STANDARD_COMPONENTS).toEqual({
      efi: {
        sku: "AS2212CBL-BT",
        variant_gid: CURRENT_BUILDER_VARIANTS.efi,
      },
      fuel: {
        sku: "FUEL-TEST-001",
        variant_gid: CURRENT_BUILDER_VARIANTS.fuel,
      },
      ignition: {
        sku: "AC2008",
        variant_gid: CURRENT_BUILDER_VARIANTS.ignition,
      },
    });

    const result = planRustHybridAcceptanceInventory({
      catalogReadback: catalogReadback(),
      builderReadback: builderReadback(),
    });
    expect(result.selected.map(({ variant_gid }) => variant_gid)).not.toEqual(
      expect.arrayContaining(Object.values(RETIRED_BUILDER_VARIANTS)),
    );
  });

  test.each(Object.entries(RETIRED_BUILDER_VARIANTS))(
    "explicitly rejects retired %s Builder Variant in Builder read-back",
    (componentName, retiredVariantId) => {
      const input = builderReadback();
      input.records.push(liveComponent({
        sku: BUILDER_STANDARD_COMPONENTS[componentName].sku,
        variantId: retiredVariantId,
      }));

      expect(() => planRustHybridAcceptanceInventory({
        catalogReadback: catalogReadback(),
        builderReadback: input,
      })).toThrow(new RegExp(`retired Builder ProductVariant ${retiredVariantId}`, "i"));
    },
  );

  test.each(Object.entries(RETIRED_BUILDER_VARIANTS))(
    "explicitly rejects retired %s Builder Variant in catalogue components",
    (componentName, retiredVariantId) => {
      const input = catalogReadback();
      input.records[0].components.push(liveComponent({
        sku: BUILDER_STANDARD_COMPONENTS[componentName].sku,
        variantId: retiredVariantId,
      }));

      expect(() => planRustHybridAcceptanceInventory({
        catalogReadback: input,
        builderReadback: builderReadback(),
      })).toThrow(new RegExp(`retired Builder ProductVariant ${retiredVariantId}`, "i"));
    },
  );

  test("uses only the active v67 acceptance window and batch", () => {
    const result = planRustHybridAcceptanceInventory({
      catalogReadback: catalogReadback(),
      builderReadback: builderReadback(),
    });

    expect(RUST_HYBRID_ACCEPTANCE_WINDOW_ID).toBe("v67-rust-hybrid-checkout-1");
    expect(RUST_HYBRID_ACCEPTANCE_BATCH_ID).toBe("rust-hybrid-v67-hosted-acceptance");
    expect(result.window_id).toBe(RUST_HYBRID_ACCEPTANCE_WINDOW_ID);
    expect(result.inventory_plan.batch_id).toBe(RUST_HYBRID_ACCEPTANCE_BATCH_ID);
    expect(JSON.stringify(result)).not.toMatch(/v66/i);
    expect(result.selected.map(({ variant_gid }) => variant_gid))
      .not.toEqual(expect.arrayContaining(Object.values(PARENTS)));
    expect(result.excluded_parent_variant_ids).toContain(PARENTS["AS2014B-BT"]);
  });

  test("explicitly rejects superseded v66 window, batch, and confirmation", () => {
    const ready = planRustHybridAcceptanceInventory({
      catalogReadback: catalogReadback(),
      builderReadback: builderReadback(),
    });
    const parameters = {
      execute: true,
      phase: "open",
      confirmation: ready.execution_confirmations.open,
      planPath: "plan.json",
    };

    expect(() => buildRustHybridAcceptanceExecutorArguments({
      ...parameters,
      result: {
        ...ready,
        window_id: "v66-rust-hybrid-checkout-1",
      },
    })).toThrow(/retired acceptance window.*v66-rust-hybrid-checkout-1/i);

    expect(() => buildRustHybridAcceptanceExecutorArguments({
      ...parameters,
      result: {
        ...ready,
        inventory_plan: {
          ...ready.inventory_plan,
          batch_id: "rust-hybrid-v66-hosted-acceptance",
        },
      },
    })).toThrow(/retired acceptance batch.*rust-hybrid-v66-hosted-acceptance/i);

    const staleConfirmation = ready.execution_confirmations.open.replace(
      RUST_HYBRID_ACCEPTANCE_WINDOW_ID,
      "v66-rust-hybrid-checkout-1",
    );
    expect(() => buildRustHybridAcceptanceExecutorArguments({
      execute: true,
      phase: "open",
      confirmation: staleConfirmation,
      planPath: "plan.json",
    })).toThrow(/retired acceptance window.*v66-rust-hybrid-checkout-1/i);
  });

  test("deduplicates shared pre-built and Builder components by exact Variant identity", () => {
    const result = planRustHybridAcceptanceInventory({
      catalogReadback: catalogReadback(),
      builderReadback: builderReadback(),
    });

    expect(result.selected.filter(({ variant_gid }) => (
      variant_gid === BUILDER_STANDARD_COMPONENTS.ignition.variant_gid
    ))).toHaveLength(1);
    expect(result.selected.find(({ variant_gid }) => (
      variant_gid === BUILDER_STANDARD_COMPONENTS.ignition.variant_gid
    )).sources).toEqual([
      "builder:standard",
      "prebuilt:AS2014B2-MK-2011-4005P",
    ]);
    expect(result.plan_checksum).toMatch(/^[0-9a-f]{8}$/);
  });

  test("places CONTINUE and already-sellable components in no_action", () => {
    const result = planRustHybridAcceptanceInventory({
      catalogReadback: catalogReadback(),
      builderReadback: builderReadback(),
    });

    expect(result.no_action).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: "AZ0010", reason: "ALREADY_SELLABLE" }),
      expect.objectContaining({ sku: "AF4005P", reason: "ALREADY_SELLABLE" }),
      expect.objectContaining({ sku: "AC2008", reason: "ALREADY_SELLABLE" }),
    ]));
    expect(result.inventory_plan.operations.every(({ open, restore }) => (
      open.expected_available === 0
      && open.expected_on_hand === 0
      && open.quantity === 1
      && restore.expected_available === 1
      && restore.expected_on_hand === 1
      && restore.quantity === 0
    ))).toBe(true);
  });

  test("returns a blocker instead of mutating an unsafe nonzero baseline", () => {
    const input = catalogReadback();
    for (const record of input.records.slice(0, 2)) {
      record.components[0].live.inventory_available = 0;
      record.components[0].live.inventory_on_hand = 3;
    }

    const result = planRustHybridAcceptanceInventory({
      catalogReadback: input,
      builderReadback: builderReadback(),
    });

    expect(result.complete).toBe(false);
    expect(result.blocked).toContainEqual(expect.objectContaining({
      sku: "AZ0004",
      reason: "UNSAFE_INVENTORY_BASELINE",
      available: 0,
      on_hand: 3,
    }));
  });

  test("fails closed with the precise missing Builder inventory field", () => {
    const input = builderReadback();
    delete input.records[0].live.inventory_on_hand;

    expect(() => planRustHybridAcceptanceInventory({
      catalogReadback: catalogReadback(),
      builderReadback: input,
    })).toThrow(/builderReadback\.records\[0\]\.live\.inventory_on_hand is required/i);
  });

  test("rejects the wrong development store", () => {
    expect(() => planRustHybridAcceptanceInventory({
      catalogReadback: catalogReadback({ store_domain: "wrong.myshopify.com" }),
      builderReadback: builderReadback(),
    })).toThrow(/catalogReadback\.store_domain/i);
  });

  test("rejects unsupported catalogue and Builder read-back schemas", () => {
    expect(() => planRustHybridAcceptanceInventory({
      catalogReadback: catalogReadback({ schema_version: "wrong.v1" }),
      builderReadback: builderReadback(),
    })).toThrow(/catalogReadback\.schema_version/i);
    expect(() => planRustHybridAcceptanceInventory({
      catalogReadback: catalogReadback(),
      builderReadback: builderReadback({ schema_version: "wrong.v1" }),
    })).toThrow(/builderReadback\.schema_version/i);
  });

  test("requires every exact Builder Standard component identity", () => {
    const input = builderReadback();
    input.records.pop();

    expect(() => planRustHybridAcceptanceInventory({
      catalogReadback: catalogReadback(),
      builderReadback: input,
    })).toThrow(/missing Builder Standard component.*51592730706198/i);
  });

  test("requires explicit execution and builds one existing CAS executor invocation", () => {
    const result = planRustHybridAcceptanceInventory({
      catalogReadback: catalogReadback(),
      builderReadback: builderReadback(),
    });
    const confirmation = result.execution_confirmations.open;

    expect(() => buildRustHybridAcceptanceExecutorArguments({
      execute: false,
      phase: "open",
      confirmation,
      planPath: "plan.json",
    })).toThrow(/--execute/i);
    expect(buildRustHybridAcceptanceExecutorArguments({
      execute: true,
      phase: "open",
      confirmation,
      planPath: "plan.json",
    })).toEqual([
      "scripts/execute-dev-catalog-acceptance-inventory-window.mjs",
      "--plan",
      "plan.json",
      "--phase",
      "open",
      "--apply",
      "--window-id",
      RUST_HYBRID_ACCEPTANCE_WINDOW_ID,
      "--confirm",
      confirmation,
    ]);
  });

  test("rejects execution when blockers exist or confirmation does not match", () => {
    const input = catalogReadback();
    for (const record of input.records.slice(0, 2)) {
      record.components[0].live.inventory_on_hand = 2;
    }
    const blocked = planRustHybridAcceptanceInventory({
      catalogReadback: input,
      builderReadback: builderReadback(),
    });

    expect(() => buildRustHybridAcceptanceExecutorArguments({
      execute: true,
      phase: "open",
      confirmation: blocked.execution_confirmations.open,
      planPath: "plan.json",
      result: blocked,
    })).toThrow(/blocked/i);

    const ready = planRustHybridAcceptanceInventory({
      catalogReadback: catalogReadback(),
      builderReadback: builderReadback(),
    });
    expect(() => buildRustHybridAcceptanceExecutorArguments({
      execute: true,
      phase: "restore",
      confirmation: "wrong",
      planPath: "plan.json",
      result: ready,
    })).toThrow(/confirmation/i);
  });

  test("CLI defaults to a local plan and prints selected/no_action/blocked", () => {
    const directory = mkdtempSync(join(tmpdir(), "rust-hybrid-inventory-test-"));
    try {
      const catalogPath = join(directory, "catalog.json");
      const builderPath = join(directory, "builder.json");
      writeFileSync(catalogPath, JSON.stringify(catalogReadback()), "utf8");
      writeFileSync(builderPath, JSON.stringify(builderReadback()), "utf8");

      const execution = spawnSync(process.execPath, [
        resolve("scripts/plan-rust-hybrid-acceptance-inventory.mjs"),
        "--catalog-readback",
        catalogPath,
        "--builder-readback",
        builderPath,
      ], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });

      expect(execution.status, execution.stderr).toBe(0);
      const output = JSON.parse(execution.stdout);
      expect(output).toEqual(expect.objectContaining({
        mode: "local_plan_only",
        window_id: "v67-rust-hybrid-checkout-1",
        plan_checksum: expect.stringMatching(/^[0-9a-f]{8}$/),
        selected: expect.any(Array),
        no_action: expect.any(Array),
        blocked: expect.any(Array),
        shopify_writes_performed: false,
      }));
      expect(output.inventory_plan.batch_id).toBe("rust-hybrid-v67-hosted-acceptance");
      expect(execution.stdout).not.toMatch(/v66/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("CLI rejects execute without the exact confirmation before invoking Shopify", () => {
    const directory = mkdtempSync(join(tmpdir(), "rust-hybrid-inventory-test-"));
    try {
      const catalogPath = join(directory, "catalog.json");
      const builderPath = join(directory, "builder.json");
      writeFileSync(catalogPath, JSON.stringify(catalogReadback()), "utf8");
      writeFileSync(builderPath, JSON.stringify(builderReadback()), "utf8");

      const execution = spawnSync(process.execPath, [
        resolve("scripts/plan-rust-hybrid-acceptance-inventory.mjs"),
        "--catalog-readback",
        catalogPath,
        "--builder-readback",
        builderPath,
        "--execute",
        "--phase",
        "open",
      ], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });

      expect(execution.status).not.toBe(0);
      expect(execution.stderr).toMatch(/--confirm/i);
      expect(execution.stderr).not.toMatch(/shopify cli/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
