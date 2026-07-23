import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { DEV_SHOPIFY_APP_CLIENT_ID } from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import {
  RUST_HYBRID_BUILDER_READBACK_TARGET,
  assertRustHybridBuilderReadbackIdentity,
  executeRustHybridBuilderInventoryReadback,
} from "./rust-hybrid-builder-inventory-readback.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const root = resolve(import.meta.dirname, "..");

if (isDirectInvocation()) {
  try {
    await runReadDevRustHybridBuilderInventory({
      args: process.argv.slice(2),
      rootPath: root,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function runReadDevRustHybridBuilderInventory({
  args = [],
  rootPath = root,
  dependencies = {},
} = {}) {
  if (args.includes("--session-transport")) {
    throw new Error("session transport is disabled until trusted app identity is available");
  }
  const options = parseArguments(args);
  const stdout = dependencies.stdout ?? ((value) => console.log(value));
  const stderr = dependencies.stderr ?? ((value) => console.error(value));
  if (options.help) {
    stdout(
      "Usage: node scripts/read-dev-rust-hybrid-builder-inventory.mjs "
      + "[--output <path>]\n"
      + "Runs one read-only Shopify Admin GraphQL query through Shopify CLI by default.",
    );
    return null;
  }

  const identity = assertRustHybridBuilderReadbackIdentity({
    appName: RUST_HYBRID_BUILDER_READBACK_TARGET.appName,
    appConfig: RUST_HYBRID_BUILDER_READBACK_TARGET.appConfig,
    clientId: DEV_SHOPIFY_APP_CLIENT_ID,
    store: RUST_HYBRID_BUILDER_READBACK_TARGET.store,
    apiVersion: RUST_HYBRID_BUILDER_READBACK_TARGET.apiVersion,
  });
  stderr(
    `READ-ONLY target: app=${identity.appName} config=${identity.appConfig} `
    + `store=${identity.store} client_id=${identity.clientId} api=${identity.apiVersion}`,
  );

  let directory = null;
  try {
    const makeTempDirectory = dependencies.makeTempDirectory ?? mkdtemp;
    const createCliExecutor = dependencies.createCliExecutor
      ?? createShopifyCliReadSafeExecutor;
    directory = await makeTempDirectory(
      join(tmpdir(), "aces-rust-hybrid-builder-readback-"),
    );
    const execute = createCliExecutor({
      cliEntrypoint: resolve(rootPath, "node_modules/@shopify/cli/bin/run.js"),
      directory,
      execFileAsync: dependencies.execFileAsync ?? promisify(execFile),
      root: rootPath,
      target: {
        appConfig: identity.appConfig,
        store: identity.store,
        apiVersion: identity.apiVersion,
      },
      readFileImpl: dependencies.readFileImpl ?? readFile,
      wait: dependencies.wait,
      readOnlyAttempts: 2,
    });

    const report = await executeRustHybridBuilderInventoryReadback({ identity, execute });
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
    if (directory) {
      const removeDirectory = dependencies.removeDirectory ?? rm;
      await removeDirectory(directory, { recursive: true, force: true });
    }
  }
}

function parseArguments(args) {
  const options = { help: false, outputPath: null };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (key === "--help") {
      if (args.length !== 1) throw new Error("--help cannot be combined with other arguments");
      options.help = true;
      index += 1;
      continue;
    }
    if (key === "--session-transport") {
      throw new Error("session transport is disabled until trusted app identity is available");
    }
    if (key !== "--output") {
      throw new Error(`unsupported argument "${String(key)}"; this command is read-only`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--output requires a path");
    }
    if (options.outputPath) {
      throw new Error("--output may only be provided once");
    }
    options.outputPath = value;
    index += 2;
  }
  return options;
}

function isDirectInvocation() {
  return Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}
