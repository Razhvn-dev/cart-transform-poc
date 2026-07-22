import { calculateStableValueChecksum } from "../extensions/master-kit-expand/src/config/bundle-runtime.checksum.js";

export const DEV_CATALOG_ACCEPTANCE_INVENTORY_PLAN_SCHEMA_VERSION = "dev_catalog_acceptance_inventory_plan.v1";

export function planDevCatalogAcceptanceInventoryWindows({ liveReadback } = {}) {
  if (liveReadback?.schema_version !== "dev_catalog_technical_batch_live_readback.v2" || !Array.isArray(liveReadback.records)) {
    throw new Error("live read-back must use dev_catalog_technical_batch_live_readback.v2");
  }
  const targets = deduplicateTargets(liveReadback.records.flatMap((record) => [record.parent, ...(record.components ?? [])]));
  const operations = [];
  const blockers = [];
  const noAction = [];
  for (const target of targets) {
    const decision = planTarget(target);
    if (decision.status === "window_required") operations.push(decision);
    else if (decision.status === "no_action") noAction.push(decision);
    else blockers.push(decision);
  }
  const body = {
    schema_version: DEV_CATALOG_ACCEPTANCE_INVENTORY_PLAN_SCHEMA_VERSION,
    mode: "local_plan_only",
    store_domain: liveReadback.store_domain,
    batch_id: liveReadback.batch_id,
    operations,
    no_action: noAction,
    blockers,
    complete: blockers.length === 0,
    shopify_writes_performed: false,
  };
  return { ...body, checksum: calculateStableValueChecksum(body) };
}

function deduplicateTargets(items) {
  const byVariant = new Map();
  for (const item of items) {
    if (!item?.live?.variant_gid) continue;
    const existing = byVariant.get(item.live.variant_gid);
    if (existing && (existing.sku !== item.sku || existing.live.inventory_item_gid !== item.live.inventory_item_gid)) {
      throw new Error(`conflicting live inventory identity for ${item.live.variant_gid}`);
    }
    byVariant.set(item.live.variant_gid, item);
  }
  return [...byVariant.values()].sort((left, right) => left.sku.localeCompare(right.sku, "en"));
}

function planTarget(target) {
  const common = {
    sku: target.sku,
    role: target.role,
    variant_gid: target.live.variant_gid,
    inventory_item_gid: target.live.inventory_item_gid,
  };
  if (target.live.inventory_tracked !== true || !target.live.inventory_item_gid) {
    return { ...common, status: "blocked", reason: "INVENTORY_IDENTITY_OR_TRACKING_UNAVAILABLE" };
  }
  const available = target.live.inventory_available;
  const onHand = target.live.inventory_on_hand;
  if (!Number.isSafeInteger(available) || !Number.isSafeInteger(onHand)) {
    return { ...common, status: "blocked", reason: "INVENTORY_QUANTITIES_UNAVAILABLE" };
  }
  if (target.live.inventory_policy === "CONTINUE" || (available >= 1 && target.live.sellable_online_quantity >= 1)) {
    return { ...common, status: "no_action", reason: "ALREADY_SELLABLE", available, on_hand: onHand };
  }
  if (target.live.inventory_policy !== "DENY") {
    return { ...common, status: "blocked", reason: "UNSUPPORTED_INVENTORY_POLICY", available, on_hand: onHand };
  }
  if (available !== 0 || onHand !== 0) {
    return { ...common, status: "blocked", reason: "UNSAFE_INVENTORY_BASELINE", available, on_hand: onHand };
  }
  return {
    ...common,
    status: "window_required",
    reason: "CHECKOUT_ACCEPTANCE_REQUIRES_ONE_SELLABLE_UNIT",
    open: { expected_available: 0, expected_on_hand: 0, quantity: 1 },
    restore: { expected_available: 1, expected_on_hand: 1, quantity: 0 },
  };
}
