export async function executeDevCatalogTechnicalBatchQuery({ execute, queryText, locationId } = {}) {
  if (typeof execute !== "function") throw new Error("Shopify query executor is required");
  try {
    const payload = await execute(fullReadbackQuery(), { variables: { query: queryText, locationId } });
    return { nodes: payload.data?.productVariants?.nodes ?? [], inventory_readback: "available" };
  } catch (error) {
    if (!isInventoryScopeError(error)) throw error;
    const payload = await execute(catalogueReadbackQuery(), { variables: { query: queryText } });
    return { nodes: payload.data?.productVariants?.nodes ?? [], inventory_readback: "unavailable_scope" };
  }
}

function isInventoryScopeError(error) {
  return typeof error?.message === "string"
    && error.message.includes("Required access: `read_inventory` access scope");
}

function fullReadbackQuery() {
  return `#graphql
    query DevCatalogTechnicalBatchReadback($query: String!, $locationId: ID!) {
      productVariants(first: 100, query: $query) {
        nodes {
          id sku price compareAtPrice sellableOnlineQuantity inventoryPolicy
          inventoryItem {
            id tracked
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available", "on_hand"]) { name quantity }
            }
          }
          product { id handle title status onlineStoreUrl }
        }
      }
    }
  `;
}

function catalogueReadbackQuery() {
  return `#graphql
    query DevCatalogTechnicalBatchCatalogueReadback($query: String!) {
      productVariants(first: 100, query: $query) {
        nodes {
          id sku price compareAtPrice
          product { id handle title status onlineStoreUrl }
        }
      }
    }
  `;
}
