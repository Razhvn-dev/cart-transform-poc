#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import ExcelJS from "exceljs";
import { isReadOnlyGraphql, isTransientShopifyCliTransportError } from "./shopify-cli-read-safe-executor.js";
import { bindExistingIds, buildSourceCatalog, createDevCatalogPlan, fingerprintText, isVerifiedImportedProduct } from "./dev-catalog-import.js";

const STORE = "huang-mvqquz1p.myshopify.com";
const API_VERSION = "2026-04";
const DEV_CLIENT_ID = "d25c62f609855572f3f266765d105ebb";
const PRODUCTS_QUERY = `#graphql
  query DevelopmentCatalogProducts($cursor: String) {
    products(first: 100, after: $cursor, sortKey: ID) {
      nodes {
        id title handle status
        variantsCount { count }
        variants(first: 250) { nodes { id sku } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const PRODUCT_SET_MUTATION = `#graphql
  mutation ImportDevelopmentProduct($identifier: ProductSetIdentifiers, $input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(identifier: $identifier, input: $input, synchronous: $synchronous) {
      product { id handle title variantsCount { count } }
      productSetOperation { id status userErrors { code field message } }
      userErrors { code field message }
    }
  }
`;
const PRODUCT_OPERATION_QUERY = `#graphql
  query DevelopmentProductOperation($id: ID!) {
    productOperation(id: $id) {
      ... on ProductSetOperation {
        id status
        product { id handle title variantsCount { count } }
        userErrors { code field message }
      }
    }
  }
`;
const PRODUCT_DELETE_MUTATION = `#graphql
  mutation DeleteDevelopmentProduct($input: ProductDeleteInput!) {
    productDelete(input: $input, synchronous: true) {
      deletedProductId
      userErrors { code field message }
    }
  }
`;
const args = parseArgs(process.argv.slice(2));
if (args.store !== STORE) throw new Error(`only ${STORE} is allowed`);
if (!args.productsCsv) throw new Error("--products-csv is required");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliEntrypoint = join(process.env.APPDATA, "npm", "node_modules", "@shopify", "cli", "bin", "run.js");
const cliDirectory = await mkdtemp(join(tmpdir(), "aces-dev-catalog-import-"));
const execFileAsync = promisify(execFile);

const csvText = await readFile(resolve(args.productsCsv), "utf8");
const products = await readProductsCsv(resolve(args.productsCsv));
const execute = createStoreExecutor({ cliEntrypoint, directory: cliDirectory, execFileAsync, root });

try {
  const identity = await execute(`query ImportIdentity { shop { id name myshopifyDomain } }`);
  if (identity.data.shop.myshopifyDomain !== STORE) throw new Error("Shopify store identity mismatch");
  const existingBefore = await listProducts(execute);
  const plan = createDevCatalogPlan({ products, existingProducts: existingBefore, sourceFingerprint: fingerprintText(csvText) });

  if (!args.apply) {
    console.log(JSON.stringify({ mode: "plan", store: STORE, app_client_id: DEV_CLIENT_ID, ...plan }, null, 2));
    process.exitCode = 0;
  } else {
    if (!args.confirmation || args.confirmation !== plan.confirmation_token) {
      throw new Error(`confirmation token mismatch; current token is ${plan.confirmation_token}`);
    }
    const result = await applyPlan({ execute, products, existingBefore, plan });
    const reportPath = args.report ?? resolve(root, ".local", `dev-catalog-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await mkdir(resolve(reportPath, ".."), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ ...result.summary, report: reportPath }, null, 2));
  }
} finally {
  await rm(cliDirectory, { recursive: true, force: true });
}

async function applyPlan({ execute, products, existingBefore, plan }) {
  const existingByHandle = new Map(existingBefore.map((product) => [product.handle, product]));
  const imported = [];
  for (const [index, product] of products.entries()) {
    const existing = existingByHandle.get(product.handle);
    if (isVerifiedImportedProduct(product, existing)) {
      imported.push({ id: existing.id, handle: existing.handle, expected_variant_count: product.expected_variant_count, resumed: true });
      if ((index + 1) % 10 === 0) console.log(`Verified ${index + 1}/${products.length} products`);
      continue;
    }
    const input = bindExistingIds(product, existing);
    const synchronous = product.expected_variant_count <= 100;
    const response = await execute(PRODUCT_SET_MUTATION, {
      variables: {
        identifier: existing ? { id: existing.id } : { handle: product.handle },
        input,
        synchronous,
      },
    });
    const payload = response.data.productSet;
    assertUserErrors(payload.userErrors, `productSet ${product.handle}`);
    let completed = payload.product;
    if (!synchronous) completed = await waitForProductOperation(execute, payload.productSetOperation, product.handle);
    if (!completed?.id) throw new Error(`productSet ${product.handle} returned no product`);
    imported.push({ id: completed.id, handle: completed.handle, expected_variant_count: product.expected_variant_count });
    if ((index + 1) % 10 === 0 || index + 1 === products.length) {
      console.log(`Imported ${index + 1}/${products.length} products`);
    }
  }

  const afterImport = await listProducts(execute);
  const afterByHandle = new Map(afterImport.map((product) => [product.handle, product]));
  const verificationErrors = [];
  for (const product of products) {
    const persisted = afterByHandle.get(product.handle);
    if (!persisted) verificationErrors.push(`${product.handle}: missing after import`);
    else if (persisted.variantsCount.count !== product.expected_variant_count) {
      verificationErrors.push(`${product.handle}: expected ${product.expected_variant_count} variants, received ${persisted.variantsCount.count}`);
    }
  }
  if (verificationErrors.length) throw new Error(`catalog read-back failed: ${verificationErrors.slice(0, 10).join("; ")}`);

  const deleted = [];
  for (const candidate of plan.cleanup) {
    const current = afterByHandle.get(candidate.handle);
    if (!current || current.id !== candidate.id) throw new Error(`cleanup target drifted: ${candidate.handle}`);
    const response = await execute(PRODUCT_DELETE_MUTATION, { variables: { input: { id: candidate.id } } });
    assertUserErrors(response.data.productDelete.userErrors, `productDelete ${candidate.handle}`);
    if (response.data.productDelete.deletedProductId !== candidate.id) throw new Error(`productDelete ${candidate.handle} was not confirmed`);
    deleted.push(candidate);
  }

  const finalProducts = await listProducts(execute);
  const finalHandles = new Set(finalProducts.map((product) => product.handle));
  const remainingCleanup = plan.cleanup.filter((product) => finalHandles.has(product.handle));
  if (remainingCleanup.length) throw new Error(`cleanup read-back failed: ${remainingCleanup.map((product) => product.handle).join(", ")}`);

  return {
    schema_version: "dev_catalog_import_result.v1",
    mode: "applied",
    store: STORE,
    app_client_id: DEV_CLIENT_ID,
    source_fingerprint: plan.source_fingerprint,
    confirmation_token: plan.confirmation_token,
    summary: {
      imported_products: imported.length,
      imported_variants: plan.summary.source_variants,
      deleted_products: deleted.length,
      runtime_preserved_products: plan.preserved.length,
      final_product_count: finalProducts.length,
      inventory_policy_override: "CONTINUE",
      inventory_tracking_override: false,
      native_requires_components: false,
    },
    imported,
    deleted,
    preserved: plan.preserved,
    completed_at: new Date().toISOString(),
  };
}

async function readProductsCsv(path) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = await workbook.csv.readFile(path);
  const headers = worksheet.getRow(1).values.slice(1).map(String);
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = { __row_number: rowNumber };
    headers.forEach((header, index) => { record[header] = row.getCell(index + 1).value ?? ""; });
    rows.push(record);
  });
  return buildSourceCatalog(rows);
}

async function listProducts(execute) {
  const products = [];
  let cursor = null;
  do {
    const response = await execute(PRODUCTS_QUERY, { variables: { cursor } });
    products.push(...response.data.products.nodes);
    cursor = response.data.products.pageInfo.hasNextPage ? response.data.products.pageInfo.endCursor : null;
  } while (cursor);
  return products;
}

async function waitForProductOperation(execute, initial, handle) {
  if (!initial?.id) throw new Error(`async productSet ${handle} returned no operation`);
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const response = await execute(PRODUCT_OPERATION_QUERY, { variables: { id: initial.id } });
    const operation = response.data.productOperation;
    if (operation.status === "COMPLETE") {
      assertUserErrors(operation.userErrors, `productSet operation ${handle}`);
      return operation.product;
    }
    if (operation.status === "FAILED") {
      assertUserErrors(operation.userErrors, `productSet operation ${handle}`);
      throw new Error(`productSet operation ${handle} failed`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  throw new Error(`productSet operation ${handle} timed out`);
}

function createStoreExecutor({ cliEntrypoint: entrypoint, directory, execFileAsync: run, root: cwd }) {
  let requestNumber = 0;
  return async function executeStore(query, { variables = {} } = {}) {
    const readOnly = isReadOnlyGraphql(query);
    const attempts = readOnly ? 6 : 4;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const outputFile = join(directory, `response-${requestNumber += 1}.json`);
      const cliArgs = [entrypoint, "store", "execute", "--store", STORE, "--version", API_VERSION,
        "--query", query, "--variables", JSON.stringify(variables), "--output-file", outputFile, "--no-color"];
      if (!readOnly) cliArgs.push("--allow-mutations");
      try {
        await run(process.execPath, cliArgs, { cwd, windowsHide: true, timeout: 120_000 });
        const payload = JSON.parse(await readFile(outputFile, "utf8"));
        const response = payload?.data ? payload : { data: payload };
        if (!response.data || response.errors?.length) throw new Error(`Shopify returned no data: ${JSON.stringify(payload)}`);
        return response;
      } catch (error) {
        lastError = error;
        const safePreConnectionRetry = !readOnly && isTlsPreConnectionFailure(error);
        if ((!readOnly && !safePreConnectionRetry)
          || (readOnly && !isTransientShopifyCliTransportError(error))
          || attempt === attempts) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250 * attempt));
      }
    }
    throw new Error(readOnly
      ? `Shopify Store Execute read failed after ${attempts} attempts`
      : "Shopify Store Execute mutation outcome is unknown; stop and reconcile before retrying", { cause: lastError });
  };
}

function isTlsPreConnectionFailure(error) {
  return [error?.message, error?.stderr, error?.cause?.message]
    .filter((value) => typeof value === "string")
    .join("\n")
    .toLowerCase()
    .includes("before secure tls connection was established");
}

function assertUserErrors(errors, label) {
  if (!Array.isArray(errors) || errors.length === 0) return;
  throw new Error(`${label}: ${errors.map((error) => `${error.code ?? "ERROR"} ${error.field?.join(".") ?? ""} ${error.message}`).join("; ")}`);
}

function parseArgs(argv) {
  const result = { store: STORE, apply: false, productsCsv: null, confirmation: null, report: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") result.apply = true;
    else if (arg === "--store") result.store = argv[++index];
    else if (arg === "--products-csv") result.productsCsv = argv[++index];
    else if (arg === "--confirmation") result.confirmation = argv[++index];
    else if (arg === "--report") result.report = resolve(argv[++index]);
    else throw new Error(`unsupported argument ${arg}`);
  }
  return result;
}
