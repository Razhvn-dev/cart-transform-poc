#!/usr/bin/env node
/**
 * Publish POC test products to the Online Store sales channel.
 *
 * Usage:
 *   node scripts/publish-test-products.mjs --store your-store.myshopify.com
 */

import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PRODUCT_TITLES = [
  "Master Kit Test",
  "EFI Test",
  "Fuel Test",
  "Fuel Test 2",
  "Coil Test",
];

function parseArgs() {
  const storeIndex = process.argv.indexOf("--store");
  if (storeIndex === -1 || !process.argv[storeIndex + 1]) {
    console.error(
      "Usage: node scripts/publish-test-products.mjs --store <store>.myshopify.com",
    );
    process.exit(1);
  }
  return process.argv[storeIndex + 1];
}

function runStoreQuery(store, query, variables = {}, allowMutations = false) {
  const tempDir = mkdtempSync(join(tmpdir(), "shopify-publish-"));
  const queryFile = join(tempDir, "operation.graphql");
  const variableFile = join(tempDir, "variables.json");

  try {
    writeFileSync(queryFile, query, "utf8");
    writeFileSync(variableFile, JSON.stringify(variables), "utf8");

    let command = `shopify store execute --store ${store} --version 2026-04 --json --query-file "${queryFile}" --variable-file "${variableFile}"`;
    if (allowMutations) {
      command += " --allow-mutations";
    }

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const stdout = execSync(command, {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return JSON.parse(stdout);
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          console.log(`  Retry ${attempt}/3...`);
        }
      }
    }

    throw lastError;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function ensureAuth(store) {
  try {
    execSync(
      `shopify store execute --store ${store} --json --query "query { shop { id } }"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    console.log("✓ Using existing store authentication\n");
  } catch {
    execSync(
      `shopify store auth --store ${store} --scopes write_products,read_products,read_publications,write_publications`,
      { stdio: "inherit" },
    );
  }
}

function getOnlineStorePublication(store) {
  const result = runStoreQuery(
    store,
    `query {
      publications(first: 20) {
        nodes {
          id
          name
          catalog { title }
        }
      }
    }`,
  );

  const publication = result.publications.nodes.find(
    (node) =>
      node.name === "Online Store" ||
      node.catalog?.title === "Online Store" ||
      node.name?.includes("在线商店"),
  );

  if (!publication) {
    throw new Error("Could not find Online Store publication");
  }

  return publication;
}

function getProductsByTitles(store, titles) {
  const query = titles.map((title) => `title:'${title.replace(/'/g, "\\'")}'`).join(" OR ");
  const result = runStoreQuery(
    store,
    `query FindProducts($query: String!) {
      products(first: 20, query: $query) {
        nodes {
          id
          title
          status
        }
      }
    }`,
    { query },
  );

  return result.products.nodes;
}

function publishProduct(store, productId, publicationId) {
  const result = runStoreQuery(
    store,
    `mutation PublishProduct($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable {
          ... on Product {
            id
            title
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      id: productId,
      input: [{ publicationId }],
    },
    true,
  );

  const payload = result.publishablePublish;
  if (payload?.userErrors?.length) {
    throw new Error(
      payload.userErrors.map((error) => error.message).join(", "),
    );
  }

  return payload.publishable;
}

function main() {
  const store = parseArgs();
  console.log(`Publishing POC products on ${store}...\n`);

  ensureAuth(store);

  const publication = getOnlineStorePublication(store);
  console.log(`✓ Online Store publication: ${publication.name} (${publication.id})\n`);

  const products = getProductsByTitles(store, PRODUCT_TITLES);
  if (products.length === 0) {
    throw new Error("No test products found. Run npm run seed:products first.");
  }

  for (const product of products) {
    const published = publishProduct(store, product.id, publication.id);
    console.log(`✓ Published: ${published.title}`);
  }

  console.log("\nDone. Open your storefront:");
  console.log(`  https://${store}/collections/all`);
  console.log("\nOr add Master Kit Test directly to cart:");
  console.log(`  https://${store}/cart/51505325605142:1`);
}

main();
