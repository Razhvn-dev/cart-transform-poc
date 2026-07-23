import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  RUST_HYBRID_BUILDER_COMPONENTS,
  RUST_HYBRID_BUILDER_INVENTORY_READBACK_SCHEMA_VERSION,
  RUST_HYBRID_BUILDER_READBACK_TARGET,
  assertRustHybridBuilderReadbackIdentity,
  buildRustHybridBuilderInventoryReadbackRequest,
  createRustHybridBuilderInventoryReadback,
  executeRustHybridBuilderInventoryReadback,
} from "./rust-hybrid-builder-inventory-readback.js";

const CURRENT_BUILDER_VARIANTS = Object.freeze({
  efi: "gid://shopify/ProductVariant/51592538587414",
  fuel: "gid://shopify/ProductVariant/51505348346134",
  ignition: "gid://shopify/ProductVariant/51592730706198",
});
const RETIRED_BUILDER_VARIANTS = Object.freeze({
  efi: "gid://shopify/ProductVariant/51552319766806",
  ignition: "gid://shopify/ProductVariant/51552321011990",
});

function exactIdentity(overrides = {}) {
  return {
    appName: RUST_HYBRID_BUILDER_READBACK_TARGET.appName,
    appConfig: RUST_HYBRID_BUILDER_READBACK_TARGET.appConfig,
    clientId: RUST_HYBRID_BUILDER_READBACK_TARGET.clientId,
    store: RUST_HYBRID_BUILDER_READBACK_TARGET.store,
    apiVersion: RUST_HYBRID_BUILDER_READBACK_TARGET.apiVersion,
    ...overrides,
  };
}

function livePayload() {
  return {
    data: {
      locations: {
        nodes: [{
          id: RUST_HYBRID_BUILDER_READBACK_TARGET.locationId,
          name: RUST_HYBRID_BUILDER_READBACK_TARGET.locationName,
          isActive: true,
        }],
        pageInfo: { hasNextPage: false },
      },
      nodes: Object.values(RUST_HYBRID_BUILDER_COMPONENTS).map((component, index) => ({
        __typename: "ProductVariant",
        id: component.variant_gid,
        sku: component.sku,
        inventoryPolicy: "DENY",
        sellableOnlineQuantity: index,
        inventoryItem: {
          id: `gid://shopify/InventoryItem/${7000 + index}`,
          tracked: true,
          inventoryLevel: {
            quantities: [
              { name: "available", quantity: index },
              { name: "on_hand", quantity: index + 1 },
            ],
          },
        },
      })),
    },
  };
}

async function importCliModuleSafely() {
  const originalArgv = process.argv;
  const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  process.argv = [process.execPath, "read-dev-rust-hybrid-builder-inventory.mjs", "--help"];
  try {
    return await import("./read-dev-rust-hybrid-builder-inventory.mjs?transport-regression");
  } finally {
    process.argv = originalArgv;
    consoleLog.mockRestore();
  }
}

describe("Rust hybrid Builder inventory read-back", () => {
  test("builds one read-only Admin GraphQL 2026-04 request for the three locked Variants", () => {
    const request = buildRustHybridBuilderInventoryReadbackRequest();

    expect(RUST_HYBRID_BUILDER_COMPONENTS).toEqual({
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
    expect(RUST_HYBRID_BUILDER_READBACK_TARGET.apiVersion).toBe("2026-04");
    expect(request.query.trimStart()).toMatch(/^query\b/);
    expect(request.query).not.toMatch(/\bmutation\b/i);
    expect(request.query).toMatch(/sellableOnlineQuantity/);
    expect(request.query).toMatch(/inventoryPolicy/);
    expect(request.query).toMatch(/quantities\(names:\s*\["available",\s*"on_hand"\]\)/);
    expect(request.variables).toEqual({
      variantIds: Object.values(CURRENT_BUILDER_VARIANTS),
      locationId: RUST_HYBRID_BUILDER_READBACK_TARGET.locationId,
    });
    expect(request.variables.variantIds).not.toEqual(
      expect.arrayContaining(Object.values(RETIRED_BUILDER_VARIANTS)),
    );
  });

  test("emits the exact planner schema from a valid unique Shop location read-back", () => {
    const report = createRustHybridBuilderInventoryReadback({
      identity: exactIdentity(),
      payload: livePayload(),
    });

    expect(report).toEqual({
      schema_version: RUST_HYBRID_BUILDER_INVENTORY_READBACK_SCHEMA_VERSION,
      mode: "shopify_admin_read_only",
      store_domain: RUST_HYBRID_BUILDER_READBACK_TARGET.store,
      location: {
        id: RUST_HYBRID_BUILDER_READBACK_TARGET.locationId,
        name: RUST_HYBRID_BUILDER_READBACK_TARGET.locationName,
      },
      records: Object.values(RUST_HYBRID_BUILDER_COMPONENTS).map((component, index) => ({
        sku: component.sku,
        role: "component",
        live: {
          variant_gid: component.variant_gid,
          inventory_item_gid: `gid://shopify/InventoryItem/${7000 + index}`,
          inventory_tracked: true,
          inventory_policy: "DENY",
          inventory_available: index,
          inventory_on_hand: index + 1,
          sellable_online_quantity: index,
        },
      })),
      shopify_writes_performed: false,
    });
    expect(report.records.map(({ live }) => live.variant_gid)).not.toEqual(
      expect.arrayContaining(Object.values(RETIRED_BUILDER_VARIANTS)),
    );
  });

  test.each(Object.entries(RETIRED_BUILDER_VARIANTS))(
    "explicitly rejects retired %s Builder Variant identity",
    (componentName, retiredVariantId) => {
      const payload = livePayload();
      const componentIndex = Object.keys(RUST_HYBRID_BUILDER_COMPONENTS)
        .indexOf(componentName);
      const staleNode = structuredClone(payload.data.nodes[componentIndex]);
      staleNode.id = retiredVariantId;
      payload.data.nodes.push(staleNode);

      expect(() => createRustHybridBuilderInventoryReadback({
        identity: exactIdentity(),
        payload,
      })).toThrow(new RegExp(`retired Builder ProductVariant ${retiredVariantId}`, "i"));
    },
  );

  test.each([
    ["appName", "cart-transform-poc"],
    ["appConfig", "shopify.app.toml"],
    ["clientId", "wrong-client-id"],
    ["store", "wrong.myshopify.com"],
    ["apiVersion", "2025-10"],
  ])("fails closed when exact development identity field %s differs", (field, value) => {
    expect(() => assertRustHybridBuilderReadbackIdentity(exactIdentity({
      [field]: value,
    }))).toThrow(new RegExp(field, "i"));
  });

  test("requires exactly one active locked Shop location", () => {
    const duplicate = livePayload();
    duplicate.data.locations.nodes.push({
      id: "gid://shopify/Location/999",
      name: RUST_HYBRID_BUILDER_READBACK_TARGET.locationName,
      isActive: true,
    });
    expect(() => createRustHybridBuilderInventoryReadback({
      identity: exactIdentity(),
      payload: duplicate,
    })).toThrow(/exactly one.*Shop location/i);

    const wrongId = livePayload();
    wrongId.data.locations.nodes[0].id = "gid://shopify/Location/999";
    expect(() => createRustHybridBuilderInventoryReadback({
      identity: exactIdentity(),
      payload: wrongId,
    })).toThrow(/location.*id/i);
  });

  test("requires a one-to-one match for every locked Variant GID and SKU", () => {
    const missing = livePayload();
    missing.data.nodes.pop();
    expect(() => createRustHybridBuilderInventoryReadback({
      identity: exactIdentity(),
      payload: missing,
    })).toThrow(/missing.*ProductVariant/i);

    const mismatchedSku = livePayload();
    mismatchedSku.data.nodes[0].sku = "WRONG-SKU";
    expect(() => createRustHybridBuilderInventoryReadback({
      identity: exactIdentity(),
      payload: mismatchedSku,
    })).toThrow(/sku/i);

    const duplicate = livePayload();
    duplicate.data.nodes[1] = structuredClone(duplicate.data.nodes[0]);
    expect(() => createRustHybridBuilderInventoryReadback({
      identity: exactIdentity(),
      payload: duplicate,
    })).toThrow(/duplicate.*ProductVariant/i);
  });

  test("fails closed on missing inventory fields and GraphQL errors", () => {
    const missingOnHand = livePayload();
    missingOnHand.data.nodes[0].inventoryItem.inventoryLevel.quantities.pop();
    expect(() => createRustHybridBuilderInventoryReadback({
      identity: exactIdentity(),
      payload: missingOnHand,
    })).toThrow(/on_hand/i);

    const missingTracked = livePayload();
    delete missingTracked.data.nodes[0].inventoryItem.tracked;
    expect(() => createRustHybridBuilderInventoryReadback({
      identity: exactIdentity(),
      payload: missingTracked,
    })).toThrow(/tracked/i);

    const incompleteLocations = livePayload();
    incompleteLocations.data.locations.pageInfo.hasNextPage = true;
    expect(() => createRustHybridBuilderInventoryReadback({
      identity: exactIdentity(),
      payload: incompleteLocations,
    })).toThrow(/location.*pagination/i);

    expect(() => createRustHybridBuilderInventoryReadback({
      identity: exactIdentity(),
      payload: { errors: [{ message: "Access denied for inventoryLevel field." }] },
    })).toThrow(/Access denied.*inventoryLevel/i);
  });

  test("executes only the generated read-only request and propagates scope or transport failure", async () => {
    const calls = [];
    const report = await executeRustHybridBuilderInventoryReadback({
      identity: exactIdentity(),
      execute: async (query, { variables }) => {
        calls.push({ query, variables });
        return livePayload();
      },
    });
    expect(calls).toEqual([buildRustHybridBuilderInventoryReadbackRequest()]);
    expect(report.shopify_writes_performed).toBe(false);

    for (const error of [
      new Error("Required access: read_inventory"),
      new Error("Admin GraphQL transport failed"),
    ]) {
      await expect(executeRustHybridBuilderInventoryReadback({
        identity: exactIdentity(),
        execute: async () => {
          throw error;
        },
      })).rejects.toThrow(error.message);
    }
  });

  test("CLI exposes a read-only help path without requiring a Shopify session", () => {
    const execution = spawnSync(process.execPath, [
      resolve("scripts/read-dev-rust-hybrid-builder-inventory.mjs"),
      "--help",
    ], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });

    expect(execution.status, execution.stderr).toBe(0);
    expect(execution.stdout).toMatch(/read-only/i);
    expect(execution.stdout).toMatch(/--output/i);
  });

  test.each(["--apply", "--execute", "--write"])(
    "CLI rejects write-capable flag %s before initializing Shopify transport",
    (flag) => {
      const execution = spawnSync(process.execPath, [
        resolve("scripts/read-dev-rust-hybrid-builder-inventory.mjs"),
        flag,
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          DATABASE_URL: "this-must-not-be-used",
          SHOPIFY_API_SECRET: "this-must-not-be-used",
        },
      });

      expect(execution.status).not.toBe(0);
      expect(execution.stderr).toMatch(new RegExp(`unsupported argument.*${flag}`, "i"));
      expect(execution.stdout).toBe("");
    },
  );

  test("CLI defaults to the strict Shopify CLI read-safe transport and never initializes session state", async () => {
    const { runReadDevRustHybridBuilderInventory } = await importCliModuleSafely();
    const rootPath = process.cwd();
    const directory = resolve(rootPath, ".tmp-rust-hybrid-builder-readback-test");
    const request = buildRustHybridBuilderInventoryReadbackRequest();
    const processCalls = [];
    const localWrites = [];
    const removedDirectories = [];
    let attempt = 0;
    const output = [];

    const report = await runReadDevRustHybridBuilderInventory({
      args: ["--output", "builder-readback.json"],
      rootPath,
      dependencies: {
        makeTempDirectory: async () => directory,
        removeDirectory: async (...parameters) => removedDirectories.push(parameters),
        execFileAsync: async (...parameters) => {
          processCalls.push(parameters);
          attempt += 1;
          if (attempt === 1) {
            throw Object.assign(new Error("socket hang up"), { stderr: "socket hang up" });
          }
          return {};
        },
        readFileImpl: async () => JSON.stringify(livePayload()),
        writeFileImpl: async (...parameters) => localWrites.push(parameters),
        resolveSessionCredentials: () => {
          throw new Error("default path must not resolve session credentials");
        },
        createPrisma: () => {
          throw new Error("default path must not create Prisma");
        },
        stdout: (value) => output.push(value),
        stderr: () => {},
        wait: async () => {},
      },
    });

    expect(processCalls).toHaveLength(2);
    for (const [executable, args, options] of processCalls) {
      expect(executable).toBe(process.execPath);
      expect(args).toEqual([
        resolve(rootPath, "node_modules/@shopify/cli/bin/run.js"),
        "app",
        "execute",
        "--config",
        RUST_HYBRID_BUILDER_READBACK_TARGET.appConfig,
        "--store",
        RUST_HYBRID_BUILDER_READBACK_TARGET.store,
        "--version",
        RUST_HYBRID_BUILDER_READBACK_TARGET.apiVersion,
        "--query",
        request.query,
        "--variables",
        JSON.stringify(request.variables),
        "--output-file",
        expect.stringMatching(/response-\d+\.json$/),
        "--no-color",
      ]);
      expect(args).not.toContain("--allow-mutations");
      expect(options).toEqual({
        cwd: rootPath,
        windowsHide: true,
        timeout: 45_000,
      });
    }
    expect(report.shopify_writes_performed).toBe(false);
    expect(JSON.parse(output[0])).toEqual(report);
    expect(localWrites).toEqual([[
      resolve(rootPath, "builder-readback.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    ]]);
    expect(removedDirectories).toEqual([[
      directory,
      { recursive: true, force: true },
    ]]);
  });

  test("CLI uses the legacy session transport only when explicitly requested and disconnects Prisma", async () => {
    const { runReadDevRustHybridBuilderInventory } = await importCliModuleSafely();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue(livePayload());
    const sessionExecutorCalls = [];
    const credentialCalls = [];

    const report = await runReadDevRustHybridBuilderInventory({
      args: ["--session-transport"],
      rootPath: process.cwd(),
      dependencies: {
        makeTempDirectory: async () => {
          throw new Error("session transport must not create a CLI temp directory");
        },
        resolveSessionCredentials: (options) => {
          credentialCalls.push(options);
          return {
            clientId: RUST_HYBRID_BUILDER_READBACK_TARGET.clientId,
            clientSecret: "test-secret",
          };
        },
        createPrisma: () => ({ $disconnect: disconnect }),
        createSessionExecutor: (options) => {
          sessionExecutorCalls.push(options);
          return execute;
        },
        stdout: () => {},
        stderr: () => {},
      },
    });

    expect(report.shopify_writes_performed).toBe(false);
    expect(credentialCalls).toEqual([{
      expectedClientId: RUST_HYBRID_BUILDER_READBACK_TARGET.clientId,
      clientId: RUST_HYBRID_BUILDER_READBACK_TARGET.clientId,
      clientSecret: process.env.SHOPIFY_API_SECRET,
    }]);
    expect(sessionExecutorCalls).toEqual([expect.objectContaining({
      shop: RUST_HYBRID_BUILDER_READBACK_TARGET.store,
      apiVersion: RUST_HYBRID_BUILDER_READBACK_TARGET.apiVersion,
      clientId: RUST_HYBRID_BUILDER_READBACK_TARGET.clientId,
      clientSecret: "test-secret",
    })]);
    expect(execute).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
