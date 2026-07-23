import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  RUST_HYBRID_CATALOG_READBACK_TARGET,
  executeRustHybridCatalogInventoryReadback,
} from "./rust-hybrid-catalog-inventory-readback.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const root = resolve(import.meta.dirname, "..");

if (isDirectInvocation()) {
  try {
    await runReadDevRustHybridCatalogInventory({
      args: process.argv.slice(2),
      rootPath: root,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function runReadDevRustHybridCatalogInventory({
  args = [],
  rootPath = root,
  dependencies = {},
} = {}) {
  const options = parseArguments(args);
  const stdout = dependencies.stdout ?? ((value) => console.log(value));
  const stderr = dependencies.stderr ?? ((value) => console.error(value));
  if (options.help) {
    stdout(
      "Usage: node scripts/read-dev-rust-hybrid-catalog-inventory.mjs "
      + "--input <accepted-v2-carrier.json> [--output <fresh-v2-carrier.json>]\n"
      + "Runs one fresh exact-ID read-only Shopify Admin GraphQL query through Shopify CLI.",
    );
    return null;
  }

  stderr(
    `READ-ONLY target: app=${RUST_HYBRID_CATALOG_READBACK_TARGET.appName} `
    + `config=${RUST_HYBRID_CATALOG_READBACK_TARGET.appConfig} `
    + `store=${RUST_HYBRID_CATALOG_READBACK_TARGET.store} `
    + `client_id=${RUST_HYBRID_CATALOG_READBACK_TARGET.clientId} `
    + `api=${RUST_HYBRID_CATALOG_READBACK_TARGET.apiVersion}`,
  );

  const readFileImpl = dependencies.readFileImpl ?? readFile;
  const carrier = JSON.parse(
    await readFileImpl(resolve(rootPath, options.inputPath), "utf8"),
  );
  const makeTempDirectory = dependencies.makeTempDirectory ?? mkdtemp;
  const directory = await makeTempDirectory(
    join(tmpdir(), "aces-rust-hybrid-catalog-readback-"),
  );

  try {
    const createCliExecutor = dependencies.createCliExecutor
      ?? createShopifyCliReadSafeExecutor;
    const execute = createCliExecutor({
      cliEntrypoint: resolve(rootPath, "node_modules/@shopify/cli/bin/run.js"),
      directory,
      execFileAsync: dependencies.execFileAsync ?? promisify(execFile),
      root: rootPath,
      target: {
        appConfig: RUST_HYBRID_CATALOG_READBACK_TARGET.appConfig,
        store: RUST_HYBRID_CATALOG_READBACK_TARGET.store,
        apiVersion: RUST_HYBRID_CATALOG_READBACK_TARGET.apiVersion,
      },
      readFileImpl,
      wait: dependencies.wait,
      readOnlyAttempts: 2,
    });
    const report = await executeRustHybridCatalogInventoryReadback({
      carrier,
      execute,
    });
    if (options.outputPath) {
      const writeFileImpl = dependencies.writeFileImpl ?? writeFile;
      await writeFileImpl(
        resolve(rootPath, options.outputPath),
        `${JSON.stringify(report, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
    }
    stdout(JSON.stringify(report, null, 2));
    return report;
  } finally {
    const removeDirectory = dependencies.removeDirectory ?? rm;
    await removeDirectory(directory, { recursive: true, force: true });
  }
}

function parseArguments(args) {
  const options = { help: false, inputPath: null, outputPath: null };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (key === "--help") {
      if (args.length !== 1) {
        throw new Error("--help cannot be combined with other arguments");
      }
      options.help = true;
      index += 1;
      continue;
    }
    if (!["--input", "--output"].includes(key)) {
      throw new Error(
        `unsupported argument "${String(key)}"; this command is read-only`,
      );
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${key} requires a path`);
    }
    const field = key === "--input" ? "inputPath" : "outputPath";
    if (options[field]) throw new Error(`${key} may only be provided once`);
    options[field] = value;
    index += 2;
  }
  if (!options.help && !options.inputPath) {
    throw new Error("--input is required");
  }
  return options;
}

function isDirectInvocation() {
  return Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}
