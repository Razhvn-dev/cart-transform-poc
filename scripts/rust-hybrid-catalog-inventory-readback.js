export const RUST_HYBRID_CATALOG_READBACK_TARGET = Object.freeze({
  appName: "cart-transform-poc-dev",
  appConfig: "shopify.app.dev.toml",
  clientId: "d25c62f609855572f3f266765d105ebb",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
  locationId: "gid://shopify/Location/113335402774",
  locationName: "Shop location",
});

const SCHEMA_VERSION = "dev_catalog_technical_batch_live_readback.v2";
const ACCEPTED_MODE = "shopify_admin_read_only";
const FRESH_MODE = "shopify_admin_fresh_exact_id_read_only";
const BATCH_ID = "large-component-breadth-acceptance-v1";
const PARENT_SKUS = [
  "AS2014B-BT",
  "AS2014B2-FK-4005P",
  "AS2014B2-MK-2011-4005P",
];
const COMPONENT_COUNTS = [8, 10, 12];

const READBACK_QUERY = `query RustHybridCatalogInventoryReadback(
  $variantIds: [ID!]!
  $locationId: ID!
) {
  locations(first: 250) {
    nodes {
      id
      name
      isActive
    }
    pageInfo {
      hasNextPage
    }
  }
  nodes(ids: $variantIds) {
    __typename
    ... on ProductVariant {
      id
      sku
      price
      compareAtPrice
      sellableOnlineQuantity
      inventoryPolicy
      inventoryItem {
        id
        tracked
        inventoryLevel(locationId: $locationId) {
          quantities(names: ["available", "on_hand"]) {
            name
            quantity
          }
        }
      }
      product {
        id
        handle
        status
        onlineStoreUrl
      }
    }
  }
}`;

export function collectRustHybridCatalogVariantReferences(carrier) {
  assertAcceptedCarrier(carrier);
  const byVariantId = new Map();
  const bySku = new Map();

  for (const record of carrier.records) {
    for (const item of [record.parent, ...record.components]) {
      const sku = requiredString(item?.sku, "carrier SKU");
      const variantId = requiredGid(
        item?.live?.variant_gid,
        "ProductVariant",
        `carrier Variant GID for ${sku}`,
      );
      const existingSku = byVariantId.get(variantId);
      if (existingSku && existingSku !== sku) {
        throw new Error(
          `ProductVariant GID ${variantId} maps to conflicting SKU values `
          + `"${existingSku}" and "${sku}"`,
        );
      }
      const existingVariantId = bySku.get(sku);
      if (existingVariantId && existingVariantId !== variantId) {
        throw new Error(
          `SKU "${sku}" maps to conflicting ProductVariant GID values `
          + `${existingVariantId} and ${variantId}`,
        );
      }
      if (!existingSku) byVariantId.set(variantId, sku);
      if (!existingVariantId) bySku.set(sku, variantId);
    }
  }

  return [...byVariantId].map(([variant_gid, sku]) => ({ sku, variant_gid }));
}

export function buildRustHybridCatalogInventoryReadbackRequest(carrier) {
  const references = collectRustHybridCatalogVariantReferences(carrier);
  return {
    query: READBACK_QUERY,
    variables: {
      variantIds: references.map(({ variant_gid: variantId }) => variantId),
      locationId: RUST_HYBRID_CATALOG_READBACK_TARGET.locationId,
    },
  };
}

export function createRustHybridCatalogInventoryReadback({ carrier, payload } = {}) {
  const references = collectRustHybridCatalogVariantReferences(carrier);
  assertGraphQlPayload(payload);
  assertShopLocation(payload.data.locations);
  const liveByVariantId = readExactLiveVariants(payload.data.nodes, references);

  const records = carrier.records.map((record) => {
    const parent = refreshCarrierItem(record.parent, liveByVariantId, true);
    const components = record.components.map((component) => (
      refreshCarrierItem(component, liveByVariantId, false)
    ));
    const issues = [...parent.issues, ...components.flatMap((component) => component.issues)];
    return {
      ...record,
      status: issues.some(({ severity }) => severity === "error")
        ? "blocked"
        : issues.some(({ severity }) => severity === "review")
          ? "needs_review"
          : "ready_for_binding",
      issues,
      parent,
      components,
    };
  });

  return {
    ...carrier,
    mode: FRESH_MODE,
    summary: records.reduce((summary, record) => {
      summary.total += 1;
      summary[record.status] += 1;
      return summary;
    }, {
      total: 0,
      ready_for_binding: 0,
      needs_review: 0,
      blocked: 0,
    }),
    records,
    shopify_writes_performed: false,
    inventory_readback: "available",
  };
}

export async function executeRustHybridCatalogInventoryReadback({
  carrier,
  execute,
} = {}) {
  if (typeof execute !== "function") {
    throw new Error("a read-only Shopify Admin GraphQL transport is required");
  }
  const request = buildRustHybridCatalogInventoryReadbackRequest(carrier);
  const payload = await execute(request.query, { variables: request.variables });
  return createRustHybridCatalogInventoryReadback({ carrier, payload });
}

function assertAcceptedCarrier(carrier) {
  if (carrier?.schema_version !== SCHEMA_VERSION) {
    throw new Error(`carrier.schema_version must equal ${SCHEMA_VERSION}`);
  }
  if (carrier.mode !== ACCEPTED_MODE) {
    throw new Error(`carrier.mode must equal ${ACCEPTED_MODE}`);
  }
  if (carrier.store_domain !== RUST_HYBRID_CATALOG_READBACK_TARGET.store) {
    throw new Error(
      `carrier.store_domain must equal ${RUST_HYBRID_CATALOG_READBACK_TARGET.store}`,
    );
  }
  if (carrier.shopify_writes_performed !== false) {
    throw new Error("carrier.shopify_writes_performed must be false");
  }
  if (carrier.batch_id !== BATCH_ID) {
    throw new Error(`carrier.batch_id must equal ${BATCH_ID}`);
  }
  if (carrier.inventory_readback !== "available") {
    throw new Error("carrier.inventory_readback must equal available");
  }
  if (!Array.isArray(carrier.records) || carrier.records.length !== 3) {
    throw new Error("carrier must contain exactly three parent records");
  }
  carrier.records.forEach((record, index) => {
    if (record?.parent_sku !== PARENT_SKUS[index]) {
      throw new Error(`carrier.records[${index}].parent_sku is not the accepted parent`);
    }
    if (record.parent?.role !== "parent" || record.parent?.sku !== record.parent_sku) {
      throw new Error(`carrier.records[${index}].parent must match the parent SKU and role`);
    }
    if (!Array.isArray(record.components)
      || record.components.length !== COMPONENT_COUNTS[index]) {
      throw new Error(
        `carrier.records[${index}] must contain ${COMPONENT_COUNTS[index]} components`,
      );
    }
    const componentSkus = new Set();
    for (const component of record.components) {
      if (component?.role !== "component") {
        throw new Error(`carrier.records[${index}] component role must be component`);
      }
      const sku = requiredString(component.sku, "component SKU");
      if (componentSkus.has(sku)) {
        throw new Error(`carrier.records[${index}] contains duplicate component SKU "${sku}"`);
      }
      componentSkus.add(sku);
    }
  });
}

function assertGraphQlPayload(payload) {
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    const messages = payload.errors
      .map(({ message }) => message)
      .filter((message) => typeof message === "string" && message !== "");
    throw new Error(
      `Shopify Admin GraphQL read-back failed: ${messages.join("; ") || "unknown error"}`,
    );
  }
  if (!payload?.data || typeof payload.data !== "object") {
    throw new Error("Shopify Admin GraphQL read-back returned no data");
  }
}

function assertShopLocation(locations) {
  if (!Array.isArray(locations?.nodes)) {
    throw new Error("locations.nodes is required");
  }
  if (locations.pageInfo?.hasNextPage !== false) {
    throw new Error("Shop location pagination must be complete");
  }
  const matches = locations.nodes.filter(({ name, isActive }) => (
    name === RUST_HYBRID_CATALOG_READBACK_TARGET.locationName && isActive === true
  ));
  if (matches.length !== 1) {
    throw new Error("exactly one active Shop location is required");
  }
  if (matches[0].id !== RUST_HYBRID_CATALOG_READBACK_TARGET.locationId) {
    throw new Error("Shop location ID drift detected");
  }
}

function readExactLiveVariants(nodes, references) {
  if (!Array.isArray(nodes)) throw new Error("nodes(ids) must return an array");
  const expectedById = new Map(references.map((reference) => [
    reference.variant_gid,
    reference.sku,
  ]));
  const liveById = new Map();

  for (const node of nodes) {
    if (node?.__typename !== "ProductVariant") {
      throw new Error("nodes(ids) returned a missing or non-ProductVariant node");
    }
    const variantId = requiredGid(node.id, "ProductVariant", "fresh ProductVariant id");
    if (!expectedById.has(variantId)) {
      throw new Error(`unexpected ProductVariant ${variantId}`);
    }
    if (liveById.has(variantId)) {
      throw new Error(`duplicate ProductVariant ${variantId}`);
    }
    const expectedSku = expectedById.get(variantId);
    if (node.sku !== expectedSku) {
      throw new Error(
        `SKU drift for ProductVariant ${variantId}: expected "${expectedSku}", `
        + `received "${String(node.sku)}"`,
      );
    }
    liveById.set(variantId, validateLiveVariant(node));
  }

  for (const { variant_gid: variantId } of references) {
    if (!liveById.has(variantId)) {
      throw new Error(`missing ProductVariant ${variantId}`);
    }
  }
  return liveById;
}

function validateLiveVariant(variant) {
  requiredDecimal(variant.price, `price for ${variant.id}`);
  if (variant.compareAtPrice !== null) {
    requiredDecimal(variant.compareAtPrice, `compareAtPrice for ${variant.id}`);
  }
  requiredInteger(
    variant.sellableOnlineQuantity,
    `sellableOnlineQuantity for ${variant.id}`,
  );
  if (!["DENY", "CONTINUE"].includes(variant.inventoryPolicy)) {
    throw new Error(`inventoryPolicy for ${variant.id} must be DENY or CONTINUE`);
  }
  requiredGid(variant.product?.id, "Product", `product.id for ${variant.id}`);
  requiredString(variant.product?.handle, `product.handle for ${variant.id}`);
  if (!["ACTIVE", "ARCHIVED", "DRAFT"].includes(variant.product?.status)) {
    throw new Error(`product.status for ${variant.id} is invalid`);
  }
  if (variant.product.onlineStoreUrl !== null
    && typeof variant.product.onlineStoreUrl !== "string") {
    throw new Error(`product.onlineStoreUrl for ${variant.id} must be a string or null`);
  }
  requiredGid(
    variant.inventoryItem?.id,
    "InventoryItem",
    `inventoryItem.id for ${variant.id}`,
  );
  if (typeof variant.inventoryItem?.tracked !== "boolean") {
    throw new Error(`inventoryItem.tracked for ${variant.id} is required`);
  }
  readQuantity(variant.inventoryItem.inventoryLevel, "available", variant.id);
  readQuantity(variant.inventoryItem.inventoryLevel, "on_hand", variant.id);
  return variant;
}

function refreshCarrierItem(item, liveByVariantId, parent) {
  const variant = liveByVariantId.get(item.live.variant_gid);
  const issues = [];
  if (variant.price !== item.expected_price) {
    issues.push(issue("LIVE_PRICE_DRIFT", "review", item.sku));
  }
  if (variant.product.status !== "ACTIVE") {
    issues.push(issue("LIVE_PRODUCT_NOT_ACTIVE", "error", item.sku));
  }
  if (parent && !variant.product.onlineStoreUrl) {
    issues.push(issue("PARENT_NOT_ONLINE_STORE", "review", item.sku));
  }
  if (variant.inventoryItem.tracked !== true) {
    issues.push(issue(
      parent ? "PARENT_INVENTORY_NOT_TRACKED" : "COMPONENT_INVENTORY_NOT_TRACKED",
      "review",
      item.sku,
    ));
  }
  if (variant.inventoryPolicy === "DENY" && variant.sellableOnlineQuantity < 1) {
    issues.push(issue(
      parent
        ? "PARENT_ACCEPTANCE_INVENTORY_REQUIRED"
        : "COMPONENT_ACCEPTANCE_INVENTORY_REQUIRED",
      "review",
      item.sku,
    ));
  }
  return {
    ...item,
    live: {
      variant_gid: variant.id,
      price: variant.price,
      compare_at_price: variant.compareAtPrice,
      product_gid: variant.product.id,
      product_handle: variant.product.handle,
      product_status: variant.product.status,
      online_store_url: variant.product.onlineStoreUrl,
      sellable_online_quantity: variant.sellableOnlineQuantity,
      inventory_policy: variant.inventoryPolicy,
      inventory_item_gid: variant.inventoryItem.id,
      inventory_tracked: variant.inventoryItem.tracked,
      inventory_available: readQuantity(
        variant.inventoryItem.inventoryLevel,
        "available",
        variant.id,
      ),
      inventory_on_hand: readQuantity(
        variant.inventoryItem.inventoryLevel,
        "on_hand",
        variant.id,
      ),
    },
    issues,
  };
}

function readQuantity(inventoryLevel, name, variantId) {
  if (!Array.isArray(inventoryLevel?.quantities)) {
    throw new Error(`inventoryLevel.quantities is required for ProductVariant ${variantId}`);
  }
  const matches = inventoryLevel.quantities.filter((quantity) => quantity?.name === name);
  if (matches.length !== 1) {
    throw new Error(
      `exactly one inventoryLevel quantity "${name}" is required for `
      + `ProductVariant ${variantId}`,
    );
  }
  requiredInteger(matches[0].quantity, `inventoryLevel quantity "${name}"`);
  return matches[0].quantity;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value;
}

function requiredGid(value, type, field) {
  if (typeof value !== "string"
    || !new RegExp(`^gid://shopify/${type}/\\d+$`).test(value)) {
    throw new Error(`${field} must be a Shopify ${type} GID`);
  }
  return value;
}

function requiredDecimal(value, field) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`${field} must be a decimal string`);
  }
  return value;
}

function requiredInteger(value, field) {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be a safe integer`);
  return value;
}

function issue(code, severity, sku) {
  return { code, severity, sku };
}
