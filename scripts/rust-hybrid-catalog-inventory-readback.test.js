import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  RUST_HYBRID_CATALOG_READBACK_TARGET,
  buildRustHybridCatalogInventoryReadbackRequest,
  collectRustHybridCatalogVariantReferences,
  createRustHybridCatalogInventoryReadback,
  executeRustHybridCatalogInventoryReadback,
} from "./rust-hybrid-catalog-inventory-readback.js";

const PARENT_SKUS = [
  "AS2014B-BT",
  "AS2014B2-FK-4005P",
  "AS2014B2-MK-2011-4005P",
];

function variantReference(sku, id, role) {
  return {
    sku,
    role,
    expected_price: "10.00",
    live: {
      variant_gid: `gid://shopify/ProductVariant/${id}`,
      price: "10.00",
      product_gid: `gid://shopify/Product/${Number(id) + 1000}`,
    },
    issues: [],
  };
}

function acceptedCarrier() {
  const shared = Array.from({ length: 8 }, (_, index) => (
    variantReference(`COMP-${index + 1}`, 2001 + index, "component")
  ));
  const record = (parentSku, parentId, extras) => ({
    parent_sku: parentSku,
    status: "ready_for_binding",
    issues: [],
    parent: variantReference(parentSku, parentId, "parent"),
    components: [...shared.map((item) => structuredClone(item)), ...extras],
  });
  return {
    schema_version: "dev_catalog_technical_batch_live_readback.v2",
    mode: "shopify_admin_read_only",
    store_domain: RUST_HYBRID_CATALOG_READBACK_TARGET.store,
    batch_id: "large-component-breadth-acceptance-v1",
    summary: {
      total: 3,
      ready_for_binding: 3,
      needs_review: 0,
      blocked: 0,
    },
    records: [
      record(PARENT_SKUS[0], 1001, []),
      record(PARENT_SKUS[1], 1002, [
        variantReference("COMP-9", 2009, "component"),
        variantReference("COMP-10", 2010, "component"),
      ]),
      record(PARENT_SKUS[2], 1003, [
        variantReference("COMP-9", 2009, "component"),
        variantReference("COMP-10", 2010, "component"),
        variantReference("COMP-11", 2011, "component"),
        variantReference("COMP-12", 2012, "component"),
      ]),
    ],
    shopify_writes_performed: false,
    inventory_readback: "available",
  };
}

function liveVariant(reference, index) {
  return {
    __typename: "ProductVariant",
    id: reference.variant_gid,
    sku: reference.sku,
    price: `${20 + index}.00`,
    compareAtPrice: `${30 + index}.00`,
    sellableOnlineQuantity: index,
    inventoryPolicy: index % 2 === 0 ? "DENY" : "CONTINUE",
    inventoryItem: {
      id: `gid://shopify/InventoryItem/${5000 + index}`,
      tracked: true,
      inventoryLevel: {
        quantities: [
          { name: "available", quantity: index },
          { name: "on_hand", quantity: index + 1 },
        ],
      },
    },
    product: {
      id: `gid://shopify/Product/${6000 + index}`,
      handle: `product-${index}`,
      status: "ACTIVE",
      onlineStoreUrl: index % 2 === 0 ? null : `https://example.test/products/${index}`,
    },
  };
}

function livePayload(carrier = acceptedCarrier()) {
  const references = collectRustHybridCatalogVariantReferences(carrier);
  return {
    data: {
      locations: {
        nodes: [{
          id: RUST_HYBRID_CATALOG_READBACK_TARGET.locationId,
          name: RUST_HYBRID_CATALOG_READBACK_TARGET.locationName,
          isActive: true,
        }],
        pageInfo: { hasNextPage: false },
      },
      nodes: references.map(liveVariant),
    },
  };
}

async function importCliModule() {
  return import("./read-dev-rust-hybrid-catalog-inventory.mjs?unit-test");
}

describe("Rust hybrid catalogue exact-ID inventory refresher", () => {
  test("extracts one stable exact GID/SKU reference for every parent and component", () => {
    const references = collectRustHybridCatalogVariantReferences(acceptedCarrier());

    expect(references).toHaveLength(15);
    expect(references.slice(0, 4)).toEqual([
      {
        sku: PARENT_SKUS[0],
        variant_gid: "gid://shopify/ProductVariant/1001",
      },
      {
        sku: "COMP-1",
        variant_gid: "gid://shopify/ProductVariant/2001",
      },
      {
        sku: "COMP-2",
        variant_gid: "gid://shopify/ProductVariant/2002",
      },
      {
        sku: "COMP-3",
        variant_gid: "gid://shopify/ProductVariant/2003",
      },
    ]);
  });

  test("builds one read-only nodes(ids) query with every required fresh field", () => {
    const request = buildRustHybridCatalogInventoryReadbackRequest(acceptedCarrier());

    expect(request.query.trimStart()).toMatch(/^query\b/);
    expect(request.query).not.toMatch(/\bmutation\b/i);
    expect(request.query).toMatch(/nodes\(ids:\s*\$variantIds\)/);
    for (const token of [
      "id",
      "sku",
      "price",
      "compareAtPrice",
      "sellableOnlineQuantity",
      "inventoryPolicy",
      "inventoryItem",
      "tracked",
      "available",
      "on_hand",
      "product",
      "handle",
      "status",
      "onlineStoreUrl",
    ]) {
      expect(request.query).toContain(token);
    }
    expect(request.variables.variantIds).toEqual(
      collectRustHybridCatalogVariantReferences(acceptedCarrier())
        .map(({ variant_gid: variantId }) => variantId),
    );
    expect(request.variables.locationId).toBe(
      RUST_HYBRID_CATALOG_READBACK_TARGET.locationId,
    );
  });

  test("emits the same v2 carrier shape with fresh exact-ID live fields", () => {
    const carrier = acceptedCarrier();
    const report = createRustHybridCatalogInventoryReadback({
      carrier,
      payload: livePayload(carrier),
    });

    expect(report).toMatchObject({
      schema_version: "dev_catalog_technical_batch_live_readback.v2",
      mode: "shopify_admin_fresh_exact_id_read_only",
      store_domain: RUST_HYBRID_CATALOG_READBACK_TARGET.store,
      batch_id: carrier.batch_id,
      inventory_readback: "available",
      shopify_writes_performed: false,
      summary: {
        total: 3,
        blocked: 0,
      },
    });
    expect(report.records.map(({ parent_sku }) => parent_sku)).toEqual(PARENT_SKUS);
    expect(report.records.map(({ components }) => components.length)).toEqual([8, 10, 12]);
    expect(report.records[0].parent).toMatchObject({
      sku: PARENT_SKUS[0],
      role: "parent",
      expected_price: "10.00",
      live: {
        variant_gid: "gid://shopify/ProductVariant/1001",
        price: "20.00",
        compare_at_price: "30.00",
        product_gid: "gid://shopify/Product/6000",
        product_handle: "product-0",
        product_status: "ACTIVE",
        online_store_url: null,
        sellable_online_quantity: 0,
        inventory_policy: "DENY",
        inventory_item_gid: "gid://shopify/InventoryItem/5000",
        inventory_tracked: true,
        inventory_available: 0,
        inventory_on_hand: 1,
      },
    });
  });

  test("rejects a carrier that is not the accepted 3-parent 8/10/12 v2 shape", () => {
    for (const mutate of [
      (carrier) => { carrier.schema_version = "v1"; },
      (carrier) => { carrier.mode = "unknown"; },
      (carrier) => { carrier.store_domain = "wrong.myshopify.com"; },
      (carrier) => { carrier.batch_id = "wrong"; },
      (carrier) => { carrier.records.pop(); },
      (carrier) => { carrier.records[2].components.pop(); },
      (carrier) => { carrier.records[0].parent.role = "component"; },
      (carrier) => { carrier.shopify_writes_performed = true; },
    ]) {
      const carrier = acceptedCarrier();
      mutate(carrier);
      expect(
        () => collectRustHybridCatalogVariantReferences(carrier),
      ).toThrow();
    }
  });

  test("rejects conflicting carrier GID/SKU identity drift", () => {
    const gidDrift = acceptedCarrier();
    gidDrift.records[1].components[0].sku = "DIFFERENT";
    expect(
      () => collectRustHybridCatalogVariantReferences(gidDrift),
    ).toThrow(/GID.*SKU|SKU.*GID/i);

    const skuDrift = acceptedCarrier();
    skuDrift.records[1].components[0].live.variant_gid =
      "gid://shopify/ProductVariant/9999";
    expect(
      () => collectRustHybridCatalogVariantReferences(skuDrift),
    ).toThrow(/GID.*SKU|SKU.*GID/i);
  });

  test("requires exactly one fresh ProductVariant node per requested GID and SKU", () => {
    const carrier = acceptedCarrier();
    const missing = livePayload(carrier);
    missing.data.nodes.pop();
    expect(
      () => createRustHybridCatalogInventoryReadback({ carrier, payload: missing }),
    ).toThrow(/missing.*ProductVariant/i);

    const duplicate = livePayload(carrier);
    duplicate.data.nodes.push(structuredClone(duplicate.data.nodes[0]));
    expect(
      () => createRustHybridCatalogInventoryReadback({ carrier, payload: duplicate }),
    ).toThrow(/duplicate.*ProductVariant/i);

    const skuDrift = livePayload(carrier);
    skuDrift.data.nodes[0].sku = "WRONG";
    expect(
      () => createRustHybridCatalogInventoryReadback({ carrier, payload: skuDrift }),
    ).toThrow(/SKU.*drift/i);

    const unexpected = livePayload(carrier);
    unexpected.data.nodes.push(liveVariant({
      sku: "EXTRA",
      variant_gid: "gid://shopify/ProductVariant/9999",
    }, 99));
    expect(
      () => createRustHybridCatalogInventoryReadback({ carrier, payload: unexpected }),
    ).toThrow(/unexpected.*ProductVariant/i);
  });

  test("fails closed on missing location, catalogue, or inventory fields", () => {
    const carrier = acceptedCarrier();
    const cases = [
      [(payload) => { payload.data.locations.pageInfo.hasNextPage = true; }, /pagination/i],
      [(payload) => { payload.data.locations.nodes[0].name = "Wrong"; }, /Shop location/i],
      [(payload) => { delete payload.data.nodes[0].price; }, /price/i],
      [(payload) => { delete payload.data.nodes[0].product.id; }, /product\.id/i],
      [(payload) => { delete payload.data.nodes[0].inventoryItem.tracked; }, /tracked/i],
      [
        (payload) => { payload.data.nodes[0].inventoryItem.inventoryLevel.quantities.pop(); },
        /on_hand/i,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const payload = livePayload(carrier);
      mutate(payload);
      expect(
        () => createRustHybridCatalogInventoryReadback({ carrier, payload }),
      ).toThrow(pattern);
    }
  });

  test("executes only the exact read-only request", async () => {
    const carrier = acceptedCarrier();
    const execute = vi.fn().mockResolvedValue(livePayload(carrier));

    const report = await executeRustHybridCatalogInventoryReadback({
      carrier,
      execute,
    });

    expect(execute).toHaveBeenCalledExactlyOnceWith(
      buildRustHybridCatalogInventoryReadbackRequest(carrier).query,
      {
        variables: buildRustHybridCatalogInventoryReadbackRequest(carrier).variables,
      },
    );
    expect(report.shopify_writes_performed).toBe(false);
  });

  test("CLI help is read-only and --input is otherwise required", () => {
    const help = spawnSync(process.execPath, [
      resolve("scripts/read-dev-rust-hybrid-catalog-inventory.mjs"),
      "--help",
    ], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toMatch(/read-only/i);
    expect(help.stdout).toMatch(/--input/i);
    expect(help.stdout).toMatch(/--output/i);

    const missing = spawnSync(process.execPath, [
      resolve("scripts/read-dev-rust-hybrid-catalog-inventory.mjs"),
    ], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toMatch(/--input is required/i);
  });

  test.each(["--apply", "--execute", "--write", "--session-transport"])(
    "CLI rejects unsupported or write-capable flag %s before transport initialization",
    (flag) => {
      const execution = spawnSync(process.execPath, [
        resolve("scripts/read-dev-rust-hybrid-catalog-inventory.mjs"),
        flag,
      ], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
      expect(execution.status).not.toBe(0);
      expect(execution.stderr).toMatch(new RegExp(`unsupported argument.*${flag}`, "i"));
      expect(execution.stdout).toBe("");
    },
  );

  test("CLI uses two-attempt read-safe transport and optional wx output", async () => {
    const { runReadDevRustHybridCatalogInventory } = await importCliModule();
    const carrier = acceptedCarrier();
    const payload = livePayload(carrier);
    const rootPath = process.cwd();
    const directory = resolve(rootPath, ".tmp-rust-hybrid-catalog-readback-test");
    const processCalls = [];
    const writes = [];
    const removals = [];
    const output = [];
    let attempt = 0;

    const report = await runReadDevRustHybridCatalogInventory({
      args: ["--input", "carrier.json", "--output", "fresh.json"],
      rootPath,
      dependencies: {
        makeTempDirectory: async () => directory,
        removeDirectory: async (...parameters) => removals.push(parameters),
        execFileAsync: async (...parameters) => {
          processCalls.push(parameters);
          attempt += 1;
          if (attempt === 1) {
            throw Object.assign(new Error("socket hang up"), {
              stderr: "socket hang up",
            });
          }
          return {};
        },
        readFileImpl: async (path) => (
          String(path).endsWith("carrier.json")
            ? JSON.stringify(carrier)
            : JSON.stringify(payload)
        ),
        writeFileImpl: async (...parameters) => writes.push(parameters),
        wait: async () => {},
        stdout: (value) => output.push(value),
        stderr: () => {},
      },
    });

    expect(processCalls).toHaveLength(2);
    for (const [, args, options] of processCalls) {
      expect(args).toContain("app");
      expect(args).toContain("execute");
      expect(args).toContain("--query");
      expect(args).not.toContain("--allow-mutations");
      expect(options).toEqual({
        cwd: rootPath,
        windowsHide: true,
        timeout: 45_000,
      });
    }
    expect(report.mode).toBe("shopify_admin_fresh_exact_id_read_only");
    expect(JSON.parse(output[0])).toEqual(report);
    expect(writes).toEqual([[
      resolve(rootPath, "fresh.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    ]]);
    expect(removals).toEqual([[
      directory,
      { recursive: true, force: true },
    ]]);
  });
});
