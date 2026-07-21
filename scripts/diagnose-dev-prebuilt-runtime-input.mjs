import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { diagnosePrebuiltFunctionInput } from "./diagnose-prebuilt-function-input.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const TARGET = Object.freeze({
  appConfig: "shopify.app.dev.toml",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
  productGid: "gid://shopify/Product/10627515777302",
  variantGid: "gid://shopify/ProductVariant/51571819708694",
});

const target = resolveTarget(process.argv.slice(2));

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "aces-prebuilt-diagnostic-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: resolve(root, "node_modules/@shopify/cli/bin/run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target,
});

try {
  const response = await execute(`#graphql
    query DiagnosePrebuiltRuntimeInput($productId: ID!) {
      product(id: $productId) {
        id
        title
        variants(first: 100) {
          nodes { id sku }
        }
        prebuiltRuntimeMappingMetafield: metafield(
          namespace: "aces_dev"
          key: "prebuilt_bundle_runtime_mapping_v1"
        ) { value jsonValue }
        prebuiltRuntimeSnapshotMetafield: metafield(
          namespace: "aces_dev"
          key: "bundle_runtime_snapshot_v1"
        ) { value jsonValue }
      }
    }
  `, { variables: { productId: target.productGid } });

  const product = response.data.product;
  const variant = product?.variants?.nodes?.find(({ id }) => id === target.variantGid);
  if (!product || !variant) {
    throw new Error("The approved pre-built diagnostic Product/Variant could not be read back");
  }

  const input = {
    cart: {
      lines: [{
        id: "gid://shopify/CartLine/prebuilt-diagnostic",
        quantity: 1,
        bundleId: { value: "906ec234-e2b5-4bc9-a13f-a2dfedfa7694" },
        bundleSchemaVersion: { value: "1" },
        parentProductGid: { value: product.id },
        parentVariantGid: { value: variant.id },
        parentSku: { value: variant.sku ?? "" },
        parentTitle: { value: product.title ?? "" },
        merchandise: {
          __typename: "ProductVariant",
          id: variant.id,
          product: {
            id: product.id,
            prebuiltRuntimeMappingMetafield: product.prebuiltRuntimeMappingMetafield,
            prebuiltRuntimeSnapshotMetafield: product.prebuiltRuntimeSnapshotMetafield,
          },
        },
      }],
    },
  };

  console.log(JSON.stringify({
    target,
    read_back: {
      product_found: true,
      variant_found: true,
      mapping_present: product.prebuiltRuntimeMappingMetafield != null,
      snapshot_present: product.prebuiltRuntimeSnapshotMetafield != null,
    },
    diagnostic: diagnosePrebuiltFunctionInput(input),
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

function resolveTarget(args) {
  if (args.length === 0) return TARGET;
  if (args.length !== 4 || args[0] !== "--product-gid" || args[2] !== "--variant-gid") {
    throw new Error("usage: node scripts/diagnose-dev-prebuilt-runtime-input.mjs [--product-gid <gid> --variant-gid <gid>]");
  }
  const productGid = args[1];
  const variantGid = args[3];
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(productGid)
    || !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantGid)) {
    throw new Error("product and variant targets must be Shopify GIDs");
  }
  return Object.freeze({ ...TARGET, productGid, variantGid });
}
