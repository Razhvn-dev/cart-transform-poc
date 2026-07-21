import { createHash } from "node:crypto";

export const DEV_CATALOG_SCHEMA_VERSION = "dev_catalog_import.v1";

export const RUNTIME_PRESERVED_HANDLES = Object.freeze([
  "master-kit-test",
  "efi-test",
  "fuel-test",
  "fuel-test-2",
  "coil-test",
  "prebuilt-bundle-test",
]);

export const LEGACY_SOURCE_UPDATE_HANDLES = Object.freeze([
  "5-pro-handheld",
  "8-handheld",
  "aces-efi-killshot-tbi-system",
  "black-jack-pro-series-ignition-coil",
  "high-roller-cdi-ignition-box",
  "killshot-fusion-lite-efi-system",
]);

export function buildSourceCatalog(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("product CSV rows are required");
  const groups = new Map();
  for (const [index, raw] of rows.entries()) {
    const row = normalizeRow(raw);
    if (!row.Handle) continue;
    const group = groups.get(row.Handle) ?? { handle: row.Handle, rows: [], firstRowNumber: index + 2 };
    group.rows.push(row);
    groups.set(row.Handle, group);
  }

  const products = [];
  for (const group of groups.values()) {
    const metadata = group.rows.find((row) => row.Title) ?? group.rows[0];
    const variantRows = group.rows.filter((row) => row["Variant Price"] !== "");
    if (!metadata?.Title) throw new Error(`product ${group.handle} has no title`);
    if (variantRows.length === 0) throw new Error(`product ${group.handle} has no variants`);

    const optionNames = [1, 2, 3].map((position) => {
      const key = `Option${position} Name`;
      return group.rows.find((row) => row[key])?.[key] ?? "";
    });
    if (!optionNames[0]) optionNames[0] = "Title";

    const options = [];
    for (let position = 1; position <= 3; position += 1) {
      const valueKey = `Option${position} Value`;
      const values = unique(variantRows.map((row) => row[valueKey]).filter(Boolean));
      if (values.length === 0) continue;
      options.push({
        name: optionNames[position - 1] || `Option ${position}`,
        position,
        values: values.map((name) => ({ name })),
      });
    }

    const variants = variantRows.map((row, variantIndex) => ({
      source_row: row.__row_number,
      sku: row["Variant SKU"] || null,
      barcode: stripSpreadsheetApostrophe(row["Variant Barcode"]) || null,
      price: normalizeMoney(row["Variant Price"], `row ${row.__row_number} Variant Price`),
      compareAtPrice: row["Variant Compare At Price"]
        ? normalizeMoney(row["Variant Compare At Price"], `row ${row.__row_number} Variant Compare At Price`)
        : null,
      position: variantIndex + 1,
      optionValues: options.map((option) => {
        const value = row[`Option${option.position} Value`];
        if (!value) throw new Error(`row ${row.__row_number} is missing ${option.name}`);
        return { optionName: option.name, name: value };
      }),
      inventoryPolicy: "CONTINUE",
      inventoryItem: {
        tracked: false,
        requiresShipping: parseBoolean(row["Variant Requires Shipping"], true),
        ...(row["Cost per item"] ? { cost: normalizeMoney(row["Cost per item"], `row ${row.__row_number} Cost per item`) } : {}),
      },
      taxable: parseBoolean(row["Variant Taxable"], true),
      requiresComponents: false,
    }));

    const files = unique(group.rows.flatMap((row) => [row["Image Src"], row["Variant Image"]]).filter(Boolean))
      .slice(0, 250)
      .map((originalSource) => ({ originalSource, contentType: "IMAGE" }));

    products.push({
      handle: group.handle,
      source_row: group.firstRowNumber,
      expected_variant_count: variants.length,
      input: compact({
        handle: group.handle,
        title: metadata.Title,
        descriptionHtml: metadata["Body (HTML)"] || "",
        vendor: metadata.Vendor || "",
        productType: metadata.Type || "",
        tags: splitTags(metadata.Tags),
        status: normalizeStatus(metadata.Status),
        giftCard: parseBoolean(metadata["Gift Card"], false),
        seo: compact({ title: metadata["SEO Title"] || undefined, description: metadata["SEO Description"] || undefined }),
        productOptions: options,
        variants,
        files: files.length ? files : undefined,
      }),
    });
  }

  return products.sort((left, right) => left.handle.localeCompare(right.handle));
}

export function createDevCatalogPlan({ products, existingProducts, sourceFingerprint }) {
  if (!Array.isArray(products) || !Array.isArray(existingProducts)) throw new Error("products and existingProducts are required");
  const sourceHandles = new Set(products.map((product) => product.handle));
  const preservedHandles = new Set(RUNTIME_PRESERVED_HANDLES);
  const cleanup = existingProducts
    .filter((product) => !sourceHandles.has(product.handle) && !preservedHandles.has(product.handle))
    .map(summarizeExisting)
    .sort(sortByHandle);
  const preserved = existingProducts
    .filter((product) => preservedHandles.has(product.handle))
    .map(summarizeExisting)
    .sort(sortByHandle);
  const updates = existingProducts
    .filter((product) => sourceHandles.has(product.handle))
    .map(summarizeExisting)
    .sort(sortByHandle);
  const creates = products.filter((product) => !existingProducts.some((existing) => existing.handle === product.handle)).length;
  const tokenPayload = {
    schema_version: DEV_CATALOG_SCHEMA_VERSION,
    store: "huang-mvqquz1p.myshopify.com",
    source_fingerprint: sourceFingerprint,
    source_products: products.map(({ handle, expected_variant_count }) => ({ handle, expected_variant_count })),
    cleanup,
    preserved,
    updates,
  };
  return Object.freeze({
    ...tokenPayload,
    summary: {
      source_products: products.length,
      source_variants: products.reduce((sum, product) => sum + product.expected_variant_count, 0),
      creates,
      updates: updates.length,
      cleanup_deletes: cleanup.length,
      runtime_preserved: preserved.length,
    },
    confirmation_token: createHash("sha256").update(stableJson(tokenPayload)).digest("hex"),
  });
}

export function bindExistingIds(product, existingProduct) {
  const bySku = new Map();
  for (const variant of existingProduct?.variants?.nodes ?? []) {
    if (!variant.sku || bySku.has(variant.sku)) continue;
    bySku.set(variant.sku, variant.id);
  }
  const input = structuredClone(product.input);
  input.variants = input.variants.map((variant) => compact({
    ...variant,
    source_row: undefined,
    id: variant.sku ? bySku.get(variant.sku) : undefined,
  }));
  return input;
}

export function isVerifiedImportedProduct(product, existingProduct) {
  if (!existingProduct || LEGACY_SOURCE_UPDATE_HANDLES.includes(product.handle)) return false;
  if (existingProduct.variantsCount?.count !== product.expected_variant_count) return false;
  if (product.expected_variant_count > 250) return true;
  const existingSkus = new Set((existingProduct.variants?.nodes ?? []).map((variant) => variant.sku).filter(Boolean));
  return product.input.variants.every((variant) => !variant.sku || existingSkus.has(variant.sku));
}

export function fingerprintText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeRow(raw) {
  const row = {};
  for (const [key, value] of Object.entries(raw ?? {})) row[key] = value == null ? "" : String(value).trim();
  return row;
}

function normalizeMoney(value, label) {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) throw new Error(`${label} is not valid money`);
  return Number(value).toFixed(2);
}

function normalizeStatus(value) {
  const status = String(value || "DRAFT").toUpperCase();
  if (!["ACTIVE", "ARCHIVED", "DRAFT", "UNLISTED"].includes(status)) throw new Error(`unsupported product status ${value}`);
  return status;
}

function parseBoolean(value, fallback) {
  if (value === "") return fallback;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  throw new Error(`invalid boolean ${value}`);
}

function splitTags(value) {
  return value ? value.split(",").map((tag) => tag.trim()).filter(Boolean) : [];
}

function stripSpreadsheetApostrophe(value) {
  return value.startsWith("'") ? value.slice(1) : value;
}

function unique(values) {
  return [...new Set(values)];
}

function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, compact(item)]));
  }
  return value;
}

function summarizeExisting(product) {
  return { id: product.id, handle: product.handle, title: product.title };
}

function sortByHandle(left, right) {
  return left.handle.localeCompare(right.handle);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
