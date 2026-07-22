export const DEV_CATALOG_TECHNICAL_BATCH_LIVE_READBACK_SCHEMA_VERSION = "dev_catalog_technical_batch_live_readback.v2";

export function assessDevCatalogTechnicalBatchLiveReadback({ catalogReport, scope, liveVariants } = {}) {
  const candidateBySku = new Map((catalogReport?.candidates ?? []).map((candidate) => [candidate.parent_sku, candidate]));
  const liveBySku = new Map();
  for (const variant of liveVariants ?? []) {
    const entries = liveBySku.get(variant?.sku) ?? [];
    entries.push(variant);
    liveBySku.set(variant?.sku, entries);
  }
  const records = (scope?.parent_skus ?? []).map((parentSku) => {
    const candidate = candidateBySku.get(parentSku);
    if (!candidate) return { parent_sku: parentSku, status: "blocked", issues: [issue("CANDIDATE_NOT_FOUND", "error")], parent: null, components: [] };
    const parent = assessVariant(candidate.parent, liveBySku, true);
    const components = candidate.components.map((component) => assessVariant(component, liveBySku, false));
    const issues = [...parent.issues, ...components.flatMap((component) => component.issues)];
    return {
      parent_sku: parentSku,
      status: issues.some((item) => item.severity === "error") ? "blocked"
        : issues.some((item) => item.severity === "review") ? "needs_review" : "ready_for_binding",
      issues,
      parent,
      components,
    };
  });
  return {
    schema_version: DEV_CATALOG_TECHNICAL_BATCH_LIVE_READBACK_SCHEMA_VERSION,
    mode: "shopify_admin_read_only",
    store_domain: "huang-mvqquz1p.myshopify.com",
    batch_id: scope?.batch_id ?? null,
    summary: records.reduce((result, record) => {
      result.total += 1;
      result[record.status] += 1;
      return result;
    }, { total: 0, ready_for_binding: 0, needs_review: 0, blocked: 0 }),
    records,
    shopify_writes_performed: false,
  };
}

export function collectTechnicalBatchSkus(catalogReport, scope) {
  const candidateBySku = new Map((catalogReport?.candidates ?? []).map((candidate) => [candidate.parent_sku, candidate]));
  return [...new Set((scope?.parent_skus ?? []).flatMap((parentSku) => {
    const candidate = candidateBySku.get(parentSku);
    return candidate ? [parentSku, ...candidate.components.map((component) => component.sku)] : [parentSku];
  }))].sort();
}

function assessVariant(expected, liveBySku, parent) {
  const matches = liveBySku.get(expected?.sku) ?? [];
  const issues = [];
  if (matches.length === 0) issues.push(issue("LIVE_VARIANT_NOT_FOUND", "error", expected?.sku));
  if (matches.length > 1) issues.push(issue("LIVE_VARIANT_AMBIGUOUS", "error", expected?.sku));
  const live = matches.length === 1 ? matches[0] : null;
  if (live && live.price !== expected.price) issues.push(issue("LIVE_PRICE_DRIFT", "review", expected.sku));
  if (live && live.product?.status !== "ACTIVE") issues.push(issue("LIVE_PRODUCT_NOT_ACTIVE", "error", expected.sku));
  if (parent && live && !live.product?.onlineStoreUrl) issues.push(issue("PARENT_NOT_ONLINE_STORE", "review", expected.sku));
  if (live && !hasInventoryReadback(live)) issues.push(issue("INVENTORY_READBACK_UNAVAILABLE", "review", expected.sku));
  if (live && hasInventoryReadback(live) && live.inventoryItem.tracked !== true) {
    issues.push(issue(parent ? "PARENT_INVENTORY_NOT_TRACKED" : "COMPONENT_INVENTORY_NOT_TRACKED", "review", expected.sku));
  }
  if (live && hasInventoryReadback(live) && live.inventoryPolicy === "DENY" && live.sellableOnlineQuantity < 1) {
    issues.push(issue(parent ? "PARENT_ACCEPTANCE_INVENTORY_REQUIRED" : "COMPONENT_ACCEPTANCE_INVENTORY_REQUIRED", "review", expected.sku));
  }
  const quantities = new Map((live?.inventoryItem?.inventoryLevel?.quantities ?? []).map((quantity) => [quantity.name, quantity.quantity]));
  return {
    sku: expected?.sku ?? null,
    role: parent ? "parent" : "component",
    expected_price: expected?.price ?? null,
    live: live ? {
      variant_gid: live.id,
      price: live.price,
      compare_at_price: live.compareAtPrice,
      product_gid: live.product?.id ?? null,
      product_handle: live.product?.handle ?? null,
      product_status: live.product?.status ?? null,
      online_store_url: live.product?.onlineStoreUrl ?? null,
      sellable_online_quantity: live.sellableOnlineQuantity ?? null,
      inventory_policy: live.inventoryPolicy ?? null,
      inventory_item_gid: live.inventoryItem?.id ?? null,
      inventory_tracked: live.inventoryItem?.tracked ?? null,
      inventory_available: quantities.get("available") ?? null,
      inventory_on_hand: quantities.get("on_hand") ?? null,
    } : null,
    issues,
  };
}

function hasInventoryReadback(live) {
  return Number.isSafeInteger(live?.sellableOnlineQuantity)
    && typeof live?.inventoryPolicy === "string"
    && typeof live?.inventoryItem?.tracked === "boolean"
    && Array.isArray(live?.inventoryItem?.inventoryLevel?.quantities);
}

function issue(code, severity, sku = null) {
  return { code, severity, sku };
}
