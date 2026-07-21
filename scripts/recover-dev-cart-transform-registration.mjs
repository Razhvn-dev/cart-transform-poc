#!/usr/bin/env node
/**
 * Recover the single Cart Transform registration for the development app/store.
 *
 * This script is intentionally fail-closed: it only accepts the known dev store,
 * requires exactly one registration bound to the expected development Function,
 * and performs no write unless --execute is supplied. It deletes that exact
 * current registration, creates a new
 * registration for the same Function handle, and reads the binding back.
 *
 * Usage:
 *   node scripts/recover-dev-cart-transform-registration.mjs
 *   node scripts/recover-dev-cart-transform-registration.mjs --execute
 */

import { execSync } from "node:child_process";

const TARGET = Object.freeze({
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
  expectedFunctionId: "019f5e8c-0374-7577-b756-66af47a751be",
  functionHandle: "master-kit-expand",
});

const execute = process.argv.includes("--execute");

function appExecute(query, variables = {}) {
  const escapedQuery = query.replace(/\n/g, " ").replace(/"/g, '\\"');
  const escapedVariables = JSON.stringify(variables).replace(/"/g, '\\"');
  const command = [
    "shopify app execute",
    `--store ${TARGET.store}`,
    `--version ${TARGET.apiVersion}`,
    `--query \"${escapedQuery}\"`,
    `--variables \"${escapedVariables}\"`,
  ].join(" ");
  return JSON.parse(execSync(command, { encoding: "utf8" }));
}

function readRegistrations() {
  return appExecute(
    "query ReadCartTransforms { cartTransforms(first: 10) { nodes { id functionId } } }",
  ).cartTransforms?.nodes ?? [];
}

function assertExpectedRegistration(nodes) {
  if (nodes.length !== 1) {
    throw new Error(`Expected exactly one dev registration; found ${nodes.length}.`);
  }
  const [registration] = nodes;
  if (registration.functionId !== TARGET.expectedFunctionId) {
    throw new Error(`Unexpected registration: ${JSON.stringify(registration)}.`);
  }
}

const before = readRegistrations();
assertExpectedRegistration(before);

if (!execute) {
  console.log(JSON.stringify({
    mode: "dry-run",
    target: TARGET,
    currentRegistration: before[0],
    action: "Would delete this exact dev registration, recreate it with the same handle, then read it back.",
  }, null, 2));
  process.exit(0);
}

const deleted = appExecute(
  "mutation DeleteCartTransform($id: ID!) { cartTransformDelete(id: $id) { deletedId userErrors { field message } } }",
  { id: before[0].id },
).cartTransformDelete;

if (deleted?.userErrors?.length || deleted?.deletedId !== before[0].id) {
  throw new Error(`Delete failed: ${JSON.stringify(deleted)}.`);
}

const created = appExecute(
  "mutation CreateCartTransform($functionHandle: String!) { cartTransformCreate(functionHandle: $functionHandle) { cartTransform { id functionId } userErrors { field message } } }",
  { functionHandle: TARGET.functionHandle },
).cartTransformCreate;

if (created?.userErrors?.length || !created?.cartTransform?.id) {
  throw new Error(`Create failed after delete: ${JSON.stringify(created)}.`);
}

const after = readRegistrations();
if (after.length !== 1 || after[0].functionId !== TARGET.expectedFunctionId) {
  throw new Error(`Read-back failed: ${JSON.stringify(after)}.`);
}

console.log(JSON.stringify({
  mode: "executed",
  target: TARGET,
  deletedId: deleted.deletedId,
  created: created.cartTransform,
  readBack: after[0],
}, null, 2));
