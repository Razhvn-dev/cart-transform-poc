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
});

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "aces-cart-transform-diagnostic-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: resolve(root, "node_modules/@shopify/cli/bin/run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: TARGET,
});

try {
  const registrationResponse = await execute(`#graphql
    query DiagnoseCartTransformRegistrations {
      cartTransforms(first: 10) {
        nodes { id functionId }
      }
    }
  `);
  const functionResponse = await execute(`#graphql
    query DiagnoseCartTransformFunctions {
      shopifyFunctions(first: 10) {
        nodes { id title apiType }
      }
    }
  `);

  const transforms = registrationResponse.data.cartTransforms?.nodes ?? [];
  const functions = functionResponse.data.shopifyFunctions?.nodes ?? [];
  const transformFunctionIds = new Set(transforms.map(({ functionId }) => functionId));
  const boundFunctions = functions.filter(({ id }) => transformFunctionIds.has(id));

  console.log(JSON.stringify({
    target: TARGET,
    registrationCount: transforms.length,
    registrations: transforms,
    functionCount: functions.length,
    functions,
    allRegistrationsResolve: transforms.length > 0
      && boundFunctions.length === transformFunctionIds.size,
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
