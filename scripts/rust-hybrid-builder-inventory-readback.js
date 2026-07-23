export const RUST_HYBRID_BUILDER_INVENTORY_READBACK_SCHEMA_VERSION =
  "rust_hybrid_builder_component_inventory_readback.v1";

export const RUST_HYBRID_BUILDER_READBACK_TARGET = Object.freeze({
  appName: "cart-transform-poc-dev",
  appConfig: "shopify.app.dev.toml",
  clientId: "d25c62f609855572f3f266765d105ebb",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
  locationId: "gid://shopify/Location/113335402774",
  locationName: "Shop location",
});

export const RUST_HYBRID_BUILDER_COMPONENTS = Object.freeze({
  efi: Object.freeze({
    sku: "AS2212CBL-BT",
    variant_gid: "gid://shopify/ProductVariant/51592538587414",
  }),
  fuel: Object.freeze({
    sku: "FUEL-TEST-001",
    variant_gid: "gid://shopify/ProductVariant/51505348346134",
  }),
  ignition: Object.freeze({
    sku: "AC2008",
    variant_gid: "gid://shopify/ProductVariant/51592730706198",
  }),
});

const RETIRED_BUILDER_VARIANT_IDS = new Set([
  "gid://shopify/ProductVariant/51552319766806",
  "gid://shopify/ProductVariant/51552321011990",
]);

const READBACK_QUERY = `query RustHybridBuilderInventoryReadback(
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
      inventoryPolicy
      sellableOnlineQuantity
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
    }
  }
}`;

export function assertRustHybridBuilderReadbackIdentity(identity) {
  for (const field of ["appName", "appConfig", "clientId", "store", "apiVersion"]) {
    if (identity?.[field] !== RUST_HYBRID_BUILDER_READBACK_TARGET[field]) {
      throw new Error(
        `${field} must equal the locked development target `
        + `"${RUST_HYBRID_BUILDER_READBACK_TARGET[field]}"`,
      );
    }
  }
  return identity;
}

export function buildRustHybridBuilderInventoryReadbackRequest() {
  assertReadOnlyQuery(READBACK_QUERY);
  return {
    query: READBACK_QUERY,
    variables: {
      variantIds: Object.values(RUST_HYBRID_BUILDER_COMPONENTS)
        .map(({ variant_gid: variantId }) => variantId),
      locationId: RUST_HYBRID_BUILDER_READBACK_TARGET.locationId,
    },
  };
}

export function createRustHybridBuilderInventoryReadback({ identity, payload } = {}) {
  assertRustHybridBuilderReadbackIdentity(identity);
  assertGraphQlPayload(payload);
  const location = readUniqueShopLocation(payload.data.locations);
  const liveByVariantId = readLiveVariants(payload.data.nodes);

  return {
    schema_version: RUST_HYBRID_BUILDER_INVENTORY_READBACK_SCHEMA_VERSION,
    mode: "shopify_admin_read_only",
    store_domain: RUST_HYBRID_BUILDER_READBACK_TARGET.store,
    location: {
      id: location.id,
      name: location.name,
    },
    records: Object.values(RUST_HYBRID_BUILDER_COMPONENTS).map((component) => {
      const variant = liveByVariantId.get(component.variant_gid);
      if (!variant) {
        throw new Error(`missing locked ProductVariant ${component.variant_gid}`);
      }
      if (variant.sku !== component.sku) {
        throw new Error(
          `SKU mismatch for ProductVariant ${component.variant_gid}: `
          + `expected "${component.sku}", received "${String(variant.sku)}"`,
        );
      }
      return toReadbackRecord(component, variant);
    }),
    shopify_writes_performed: false,
  };
}

export async function executeRustHybridBuilderInventoryReadback({ identity, execute } = {}) {
  assertRustHybridBuilderReadbackIdentity(identity);
  if (typeof execute !== "function") {
    throw new Error("a read-only Shopify Admin GraphQL transport is required");
  }
  const request = buildRustHybridBuilderInventoryReadbackRequest();
  const payload = await execute(request.query, { variables: request.variables });
  return createRustHybridBuilderInventoryReadback({ identity, payload });
}

function assertReadOnlyQuery(query) {
  if (typeof query !== "string"
    || !/^\s*query\b/i.test(query)
    || /\bmutation\b/i.test(query)) {
    throw new Error("Builder inventory read-back requires one query-only GraphQL operation");
  }
}

function assertGraphQlPayload(payload) {
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    const messages = payload.errors
      .map((error) => error?.message)
      .filter((message) => typeof message === "string" && message !== "");
    throw new Error(`Shopify Admin GraphQL read-back failed: ${messages.join("; ") || "unknown error"}`);
  }
  if (!payload?.data || typeof payload.data !== "object") {
    throw new Error("Shopify Admin GraphQL read-back returned no data");
  }
}

function readUniqueShopLocation(locations) {
  if (!Array.isArray(locations?.nodes)) {
    throw new Error("locations.nodes is required");
  }
  if (locations?.pageInfo?.hasNextPage !== false) {
    throw new Error("location pagination must be complete before uniqueness can be verified");
  }
  const matches = locations.nodes.filter(
    (location) => location?.name === RUST_HYBRID_BUILDER_READBACK_TARGET.locationName,
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one "${RUST_HYBRID_BUILDER_READBACK_TARGET.locationName}" location; `
      + `received ${matches.length}`,
    );
  }
  const [location] = matches;
  if (location.id !== RUST_HYBRID_BUILDER_READBACK_TARGET.locationId) {
    throw new Error(
      `location id must equal "${RUST_HYBRID_BUILDER_READBACK_TARGET.locationId}"`,
    );
  }
  if (location.isActive !== true) {
    throw new Error(`location "${RUST_HYBRID_BUILDER_READBACK_TARGET.locationId}" must be active`);
  }
  return location;
}

function readLiveVariants(nodes) {
  if (!Array.isArray(nodes)) {
    throw new Error("nodes is required");
  }
  const variants = new Map();
  for (const [index, node] of nodes.entries()) {
    if (node?.__typename !== "ProductVariant" || typeof node.id !== "string") {
      throw new Error(`nodes[${index}] must be a ProductVariant`);
    }
    if (RETIRED_BUILDER_VARIANT_IDS.has(node.id)) {
      throw new Error(`retired Builder ProductVariant ${node.id} is not accepted`);
    }
    if (variants.has(node.id)) {
      throw new Error(`duplicate ProductVariant ${node.id}`);
    }
    variants.set(node.id, node);
  }
  return variants;
}

function toReadbackRecord(component, variant) {
  assertOneOf(variant.inventoryPolicy, ["DENY", "CONTINUE"], "inventoryPolicy");
  assertSafeInteger(variant.sellableOnlineQuantity, "sellableOnlineQuantity");
  const inventoryItem = variant.inventoryItem;
  if (typeof inventoryItem?.id !== "string"
    || !/^gid:\/\/shopify\/InventoryItem\/\d+$/.test(inventoryItem.id)) {
    throw new Error(`inventoryItem.id is required for ProductVariant ${variant.id}`);
  }
  if (typeof inventoryItem.tracked !== "boolean") {
    throw new Error(`inventoryItem.tracked is required for ProductVariant ${variant.id}`);
  }
  const available = readQuantity(inventoryItem.inventoryLevel, "available", variant.id);
  const onHand = readQuantity(inventoryItem.inventoryLevel, "on_hand", variant.id);
  return {
    sku: component.sku,
    role: "component",
    live: {
      variant_gid: component.variant_gid,
      inventory_item_gid: inventoryItem.id,
      inventory_tracked: inventoryItem.tracked,
      inventory_policy: variant.inventoryPolicy,
      inventory_available: available,
      inventory_on_hand: onHand,
      sellable_online_quantity: variant.sellableOnlineQuantity,
    },
  };
}

function readQuantity(inventoryLevel, name, variantId) {
  if (!Array.isArray(inventoryLevel?.quantities)) {
    throw new Error(`inventoryLevel.quantities is required for ProductVariant ${variantId}`);
  }
  const matches = inventoryLevel.quantities.filter((quantity) => quantity?.name === name);
  if (matches.length !== 1) {
    throw new Error(
      `exactly one inventoryLevel quantity "${name}" is required for ProductVariant ${variantId}`,
    );
  }
  assertSafeInteger(matches[0].quantity, `inventoryLevel quantity "${name}"`);
  return matches[0].quantity;
}

function assertOneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new Error(`${field} must be one of ${allowed.join(", ")}`);
  }
}

function assertSafeInteger(value, field) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} must be a safe integer`);
  }
}
