export function createShopifySessionAdminExecutor({
  prisma,
  shop,
  apiVersion,
  fetchImpl = fetch,
} = {}) {
  if (typeof prisma?.session?.findFirst !== "function") throw new Error("Prisma Session storage is required");
  if (typeof shop !== "string" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    throw new Error("a valid myshopify.com development store is required");
  }
  if (typeof apiVersion !== "string" || !/^\d{4}-\d{2}$/.test(apiVersion)) {
    throw new Error("a Shopify Admin API version is required");
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch is required");

  return async function execute() {
    throw new Error(
      "Shopify session transport is disabled because persisted sessions have no trusted app identity binding",
    );
  };
}
