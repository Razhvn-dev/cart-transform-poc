#!/usr/bin/env node

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
const IDS = Object.freeze([
  "gid://shopify/ProductVariant/51552319766806",
  "gid://shopify/ProductVariant/51505348346134",
  "gid://shopify/ProductVariant/51552321011990",
  "gid://shopify/ProductVariant/51571819708694",
]);
const SKUS = Object.freeze(["AF4005P", "AF2009P", "AC2008", "AZ0004", "AH2500"]);

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "aces-prebuilt-component-status-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: resolve(root, "node_modules/@shopify/cli/bin/run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: TARGET,
});

try {
  const response = await execute(`#graphql
    query PrebuiltComponentStatus($ids: [ID!]!) {
      nodes(ids: $ids) {
        id
        __typename
        ... on ProductVariant {
          title
          product { id title status }
          inventoryItem { id tracked }
        }
      }
    }
  `, { variables: { ids: IDS } });
  const skuResponse = await execute(`#graphql
    query ImportedComponentCandidates($query: String!) {
      productVariants(first: 50, query: $query) {
        nodes { id sku title product { id title status } inventoryItem { id tracked } }
      }
    }
  `, { variables: { query: SKUS.map((sku) => `sku:${sku}`).join(" OR ") } });
  const locations = await execute(`#graphql
    query DevelopmentLocations { locations(first: 20) { nodes { id name isActive } } }
  `);
  console.log(JSON.stringify({
    target: TARGET,
    ids: IDS,
    nodes: response.data.nodes,
    searchedSkus: SKUS,
    importedCandidates: skuResponse.data.productVariants?.nodes ?? [],
    locations: locations.data.locations?.nodes ?? [],
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
