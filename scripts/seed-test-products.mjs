#!/usr/bin/env node
/**
 * Creates the POC test products on a dev store and updates the hardcoded
 * Variant IDs in the Cart Transform Function.
 *
 * This script deliberately does not create Shopify native bundle component
 * relationships or set requiresComponents. Cart Transform `expand` is the
 * only bundle authority in the locked Option C architecture.
 *
 * Usage:
 *   node scripts/seed-test-products.mjs --store your-store.myshopify.com
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FUNCTION_FILE = join(ROOT, "extensions/master-kit-expand/src/run.js");

const PRODUCTS = [
  { title: "Master Kit Test", key: "MASTER", sku: "MASTER-KIT-001" },
  {
    title: "EFI Test",
    key: "EFI",
    sku: "EFI-TEST-001",
    tracked: true,
    inventoryQuantity: 10,
  },
  {
    title: "Fuel Test",
    key: "FUEL",
    sku: "FUEL-TEST-001",
    tracked: true,
    inventoryQuantity: 10,
  },
  {
    title: "Fuel Test 2",
    key: "FUEL_2",
    sku: "FUEL-TEST-002",
    tracked: true,
    inventoryQuantity: 10,
  },
  {
    title: "Coil Test",
    key: "COIL",
    sku: "COIL-TEST-001",
    tracked: true,
    inventoryQuantity: 10,
  },
];

const COMPONENT_KEYS = ["EFI", "FUEL", "FUEL_2", "COIL"];

const FIND_PRODUCT_QUERY = `query FindProduct($query: String!) {
  products(first: 1, query: $query) {
    nodes {
      id
      title
      variants(first: 1) {
        nodes {
          id
          inventoryItem {
            id
          }
        }
      }
    }
  }
}`;

const CREATE_PRODUCT_MUTATION = `mutation CreateProduct($input: ProductInput!) {
  productCreate(input: $input) {
    product {
      id
      title
      variants(first: 1) {
        nodes {
          id
          inventoryItem {
            id
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const LOCATIONS_QUERY = `query Locations {
  locations(first: 10) {
    nodes {
      id
      name
      isActive
    }
  }
}`;

const UPDATE_VARIANT_TEST_DATA_MUTATION = `mutation UpdateVariantTestData($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants {
      id
      sku
      inventoryItem {
        id
        sku
        tracked
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const SET_COMPONENT_INVENTORY_MUTATION = `mutation SetComponentInventory($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup {
      createdAt
      reason
    }
    userErrors {
      field
      message
    }
  }
}`;

function parseArgs() {
  const storeIndex = process.argv.indexOf("--store");
  if (storeIndex === -1 || !process.argv[storeIndex + 1]) {
    console.error(
      "Usage: node scripts/seed-test-products.mjs --store <store>.myshopify.com",
    );
    process.exit(1);
  }
  return process.argv[storeIndex + 1];
}

function runStoreQuery(store, query, variables = {}, allowMutations = false) {
  const tempDir = mkdtempSync(join(tmpdir(), "shopify-seed-"));
  const queryFile = join(tempDir, "operation.graphql");
  const variableFile = join(tempDir, "variables.json");

  try {
    writeFileSync(queryFile, query, "utf8");
    writeFileSync(variableFile, JSON.stringify(variables), "utf8");

    let command = `shopify store execute --store ${store} --version 2026-04 --json --query-file "${queryFile}" --variable-file "${variableFile}"`;
    if (allowMutations) {
      command += " --allow-mutations";
    }

    const attempts = allowMutations ? 1 : 3;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const stdout = execSync(command, {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return JSON.parse(stdout);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          console.log(`  Retry read-only request ${attempt}/${attempts} after network error...`);
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
      `shopify store auth --store ${store} --scopes write_products,read_products,write_inventory,read_inventory,read_locations`,
      {
        stdio: "inherit",
      },
    );
  }
}

function findProductByTitle(store, title) {
  const result = runStoreQuery(store, FIND_PRODUCT_QUERY, {
    query: `title:'${title.replace(/'/g, "\\'")}'`,
  });

  return result?.products?.nodes?.[0] ?? null;
}

function createProduct(store, title) {
  const result = runStoreQuery(
    store,
    CREATE_PRODUCT_MUTATION,
    {
      input: {
        title,
        status: "ACTIVE",
      },
    },
    true,
  );

  const payload = result?.productCreate;
  if (payload?.userErrors?.length) {
    throw new Error(
      `Failed to create "${title}": ${payload.userErrors.map((e) => e.message).join(", ")}`,
    );
  }

  return payload.product;
}

function ensureProduct(store, { title, key }) {
  const existing = findProductByTitle(store, title);
  if (existing) {
    const variantId = existing.variants.nodes[0]?.id;
    const inventoryItemId = existing.variants.nodes[0]?.inventoryItem?.id;
    console.log(`✓ Found existing product: ${title} (${variantId})`);
    return { title, key, productId: existing.id, variantId, inventoryItemId };
  }

  const created = createProduct(store, title);
  const variantId = created.variants.nodes[0]?.id;
  const inventoryItemId = created.variants.nodes[0]?.inventoryItem?.id;
  console.log(`✓ Created product: ${title} (${variantId})`);
  return { title, key, productId: created.id, variantId, inventoryItemId };
}

function getActiveLocation(store) {
  const result = runStoreQuery(store, LOCATIONS_QUERY);
  const locations = result?.locations?.nodes ?? [];
  const location = locations.find((node) => node.isActive) ?? locations[0];

  if (!location?.id) {
    throw new Error("Could not find an active inventory location");
  }

  console.log(`\nUsing inventory location: ${location.name} (${location.id})`);
  return location;
}

function updateVariantTestData(store, seededProducts) {
  for (const product of PRODUCTS) {
    const seededProduct = seededProducts[product.key];
    if (!seededProduct?.productId || !seededProduct?.variantId) {
      throw new Error(`Missing seeded product data for ${product.title}`);
    }

    const inventoryItem = { sku: product.sku };
    if (product.tracked !== undefined) {
      inventoryItem.tracked = product.tracked;
    }

    const result = runStoreQuery(
      store,
      UPDATE_VARIANT_TEST_DATA_MUTATION,
      {
        productId: seededProduct.productId,
        variants: [
          {
            id: seededProduct.variantId,
            inventoryItem,
          },
        ],
      },
      true,
    );

    const payload = result?.productVariantsBulkUpdate;
    if (payload?.userErrors?.length) {
      throw new Error(
        `Failed to update test data for ${product.title}: ${payload.userErrors
          .map((error) => error.message)
          .join(", ")}`,
      );
    }

    const variant = payload?.productVariants?.[0];
    console.log(
      `Configured ${product.title}: sku=${variant?.inventoryItem?.sku}, tracked=${variant?.inventoryItem?.tracked}`,
    );
  }
}

function setComponentInventory(store, seededProducts) {
  const location = getActiveLocation(store);
  const quantities = PRODUCTS.filter((product) =>
    COMPONENT_KEYS.includes(product.key),
  ).map((product) => {
    const seededProduct = seededProducts[product.key];
    if (!seededProduct?.inventoryItemId) {
      throw new Error(`Missing inventory item id for ${product.title}`);
    }

    return {
      inventoryItemId: seededProduct.inventoryItemId,
      locationId: location.id,
      quantity: product.inventoryQuantity,
    };
  });

  const result = runStoreQuery(
    store,
    SET_COMPONENT_INVENTORY_MUTATION,
    {
      input: {
        name: "available",
        reason: "correction",
        referenceDocumentUri: "poc://seed-test-products",
        quantities,
      },
    },
    true,
  );

  const payload = result?.inventorySetQuantities;
  if (payload?.userErrors?.length) {
    throw new Error(
      `Failed to set component inventory: ${payload.userErrors
        .map((error) => error.message)
        .join(", ")}`,
    );
  }

  console.log("\nSet component inventory:");
  for (const quantity of quantities) {
    console.log(`  ${quantity.inventoryItemId} = ${quantity.quantity}`);
  }
}

function updateFunctionVariantIds(variantMap) {
  let source = readFileSync(FUNCTION_FILE, "utf8");

  source = source.replace(
    /const MASTER_KIT_VARIANT_ID =\s*\n\s*"gid:\/\/shopify\/ProductVariant\/[^"]+";/,
    `const MASTER_KIT_VARIANT_ID =\n  "${variantMap.MASTER}";`,
  );
  source = source.replace(
    /const EFI_TEST_VARIANT_ID = "gid:\/\/shopify\/ProductVariant\/[^"]+";/,
    `const EFI_TEST_VARIANT_ID = "${variantMap.EFI}";`,
  );
  source = source.replace(
    /const FUEL_TEST_VARIANT_ID = "gid:\/\/shopify\/ProductVariant\/[^"]+";/,
    `const FUEL_TEST_VARIANT_ID = "${variantMap.FUEL}";`,
  );
  source = source.replace(
    /const FUEL_TEST_2_VARIANT_ID =\s*\n\s*"gid:\/\/shopify\/ProductVariant\/[^"]+";/,
    `const FUEL_TEST_2_VARIANT_ID =
  "${variantMap.FUEL_2}";`,
  );
  source = source.replace(
    /const COIL_TEST_VARIANT_ID = "gid:\/\/shopify\/ProductVariant\/[^"]+";/,
    `const COIL_TEST_VARIANT_ID = "${variantMap.COIL}";`,
  );

  writeFileSync(FUNCTION_FILE, source, "utf8");
  console.log(`\n✓ Updated variant IDs in ${FUNCTION_FILE}`);
  console.log(`  Master Kit Test: ${variantMap.MASTER}`);
  console.log(`  EFI Test:        ${variantMap.EFI}`);
  console.log(`  Fuel Test:       ${variantMap.FUEL}`);
  console.log(`  Fuel Test 2:     ${variantMap.FUEL_2}`);
  console.log(`  Coil Test:       ${variantMap.COIL}`);
}

function main() {
  const store = parseArgs();
  console.log(`Seeding POC products on ${store}...\n`);

  ensureAuth(store);

  const results = {};
  for (const product of PRODUCTS) {
    const { key, variantId } = ensureProduct(store, product);
    results[key] = variantId;
  }

  updateFunctionVariantIds(results);
  console.log("\nNative Shopify bundle relationships were not created.");
  console.log("Cart Transform expand remains the only bundle authority.");

  console.log("\nDone. Start the app with:");
  console.log(`  shopify app dev --store ${store}`);
}

main();
