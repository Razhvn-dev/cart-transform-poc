#!/usr/bin/env node
/**
 * Enable the cart transform function on a dev store.
 * Requires the app to be installed (run `shopify app dev` first).
 *
 * Usage:
 *   node scripts/enable-cart-transform.mjs --store huang-mvqquz1p.myshopify.com
 */

import { execSync } from "node:child_process";

const FUNCTION_HANDLE = "master-kit-expand";

function parseArgs() {
  const storeIndex = process.argv.indexOf("--store");
  if (storeIndex === -1 || !process.argv[storeIndex + 1]) {
    console.error(
      "Usage: node scripts/enable-cart-transform.mjs --store <store>.myshopify.com",
    );
    process.exit(1);
  }
  return process.argv[storeIndex + 1];
}

function appExecute(store, query, variables = {}) {
  const vars = JSON.stringify(variables).replace(/"/g, '\\"');
  const command = `shopify app execute --store ${store} --version 2026-04 --query "${query.replace(/\n/g, " ").replace(/"/g, '\\"')}" --variables "${vars}"`;
  const stdout = execSync(command, { encoding: "utf8" });
  return JSON.parse(stdout);
}

const store = parseArgs();

console.log(`Checking cart transforms on ${store}...`);

try {
  const existing = appExecute(
    store,
    "query { cartTransforms(first: 10) { nodes { id functionId } } }",
  );
  const nodes = existing?.cartTransforms?.nodes ?? [];
  if (nodes.length > 0) {
    console.log("Cart transform already enabled:");
    console.log(JSON.stringify(nodes, null, 2));
    process.exit(0);
  }
} catch (error) {
  console.error(
    "Could not query cart transforms. Is the app installed? Run `shopify app dev` and open the install link first.",
  );
  console.error(error.message?.slice(0, 400));
  process.exit(1);
}

console.log(`Creating cart transform for handle "${FUNCTION_HANDLE}"...`);

try {
  const result = appExecute(
    store,
    "mutation Enable($functionHandle: String!) { cartTransformCreate(functionHandle: $functionHandle) { cartTransform { id functionId } userErrors { field message } } }",
    { functionHandle: FUNCTION_HANDLE },
  );
  const payload = result?.cartTransformCreate;
  if (payload?.userErrors?.length) {
    console.error("cartTransformCreate failed:");
    console.error(JSON.stringify(payload.userErrors, null, 2));
    console.error(
      "\nTip: keep `shopify app dev` running so the function is available, then retry.",
    );
    process.exit(1);
  }
  console.log("Cart transform enabled:");
  console.log(JSON.stringify(payload?.cartTransform, null, 2));
} catch (error) {
  console.error("cartTransformCreate request failed:");
  console.error(error.message?.slice(0, 600));
  process.exit(1);
}
