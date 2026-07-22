import { calculateStableValueChecksum } from "../extensions/master-kit-expand/src/config/bundle-runtime.checksum.js";

const PLAN_SCHEMA_VERSION = "dev_catalog_acceptance_inventory_plan.v1";
const DEV_STORE = "huang-mvqquz1p.myshopify.com";

export function prepareDevCatalogAcceptanceInventoryMutationScope({ planChecksum, phase, windowId } = {}) {
  if (!/^[0-9a-f]{8}$/.test(planChecksum ?? "")) throw new Error("plan checksum is invalid");
  if (!["open", "restore"].includes(phase)) throw new Error("phase must be open or restore");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(windowId ?? "")) {
    throw new Error("window id is required and must contain only lowercase letters, digits, or hyphens");
  }
  return {
    window_id: windowId,
    idempotency_seed: `${planChecksum}:${phase}:${windowId}`,
    reference_path: `${planChecksum}/${windowId}/${phase}`,
    confirmation: `APPLY_DEV_INVENTORY_WINDOW:${planChecksum}:${phase}:${windowId}`,
  };
}

export function prepareDevCatalogAcceptanceInventoryReceipt({ plan, phase, mutationScope, before, after } = {}) {
  const expectedScope = prepareDevCatalogAcceptanceInventoryMutationScope({
    planChecksum: plan?.checksum,
    phase,
    windowId: mutationScope?.window_id,
  });
  if (mutationScope?.confirmation !== expectedScope.confirmation
    || mutationScope?.reference_path !== expectedScope.reference_path
    || mutationScope?.idempotency_seed !== expectedScope.idempotency_seed) {
    throw new Error("inventory mutation scope drift");
  }
  let prepared;
  try {
    prepared = prepareDevCatalogAcceptanceInventoryExecution({ plan, phase, observed: before });
  } catch (error) {
    throw new Error(`inventory mutation before read-back is invalid: ${error.message}`);
  }
  if (prepared.status !== "ready_to_apply") {
    throw new Error("inventory mutation before read-back does not require an apply operation");
  }
  const verified = prepareDevCatalogAcceptanceInventoryExecution({ plan, phase, observed: after });
  if (verified.status !== "already_at_target") throw new Error("inventory mutation read-back is incomplete");
  return {
    status: "set_and_verified",
    phase,
    plan_checksum: plan.checksum,
    window_id: expectedScope.window_id,
    confirmation: expectedScope.confirmation,
    reference_path: expectedScope.reference_path,
    shopify_writes_performed: true,
    before,
    after,
  };
}

export function prepareDevCatalogAcceptanceInventoryExecution({ plan, phase, observed } = {}) {
  validatePlan(plan);
  if (!["open", "restore"].includes(phase)) throw new Error("phase must be open or restore");
  if (!Array.isArray(observed)) throw new Error("observed inventory read-back is required");

  const observedByVariant = new Map();
  for (const item of observed) {
    if (!item?.variant_gid || observedByVariant.has(item.variant_gid)) {
      throw new Error("observed inventory contains a missing or duplicate Variant identity");
    }
    observedByVariant.set(item.variant_gid, item);
  }

  const quantities = [];
  const alreadyAtTarget = [];
  for (const operation of plan.operations) {
    const current = observedByVariant.get(operation.variant_gid);
    if (!current || current.sku !== operation.sku || current.inventory_item_gid !== operation.inventory_item_gid || current.tracked !== true) {
      throw new Error(`${operation.sku} inventory identity drift`);
    }
    const transition = operation[phase];
    const atExpected = current.available === transition.expected_available && current.on_hand === transition.expected_on_hand;
    const atTarget = current.available === transition.quantity && current.on_hand === transition.quantity;
    if (!atExpected && !atTarget) {
      throw new Error(`${operation.sku} inventory quantity drift: ${current.available}/${current.on_hand}`);
    }
    if (atTarget) {
      alreadyAtTarget.push(operation.sku);
      continue;
    }
    quantities.push({
      inventoryItemId: operation.inventory_item_gid,
      quantity: transition.quantity,
      changeFromQuantity: transition.expected_available,
    });
  }
  if (observedByVariant.size !== plan.operations.length) {
    throw new Error("observed inventory contains an unexpected target");
  }

  return {
    status: quantities.length === 0 ? "already_at_target" : "ready_to_apply",
    phase,
    plan_checksum: plan.checksum,
    confirmation: `APPLY_DEV_INVENTORY_WINDOW:${plan.checksum}:${phase}`,
    shopify_writes_performed: false,
    quantities,
    already_at_target: alreadyAtTarget,
  };
}

function validatePlan(plan) {
  if (plan?.schema_version !== PLAN_SCHEMA_VERSION || plan.mode !== "local_plan_only") {
    throw new Error("unsupported acceptance inventory plan");
  }
  if (plan.store_domain !== DEV_STORE) throw new Error("inventory plan targets an unexpected store");
  if (plan.complete !== true || plan.shopify_writes_performed !== false || plan.blockers?.length !== 0) {
    throw new Error("inventory plan is not complete and write-safe");
  }
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) throw new Error("inventory plan has no operations");
  const { checksum, ...body } = plan;
  if (!checksum || calculateStableValueChecksum(body) !== checksum) throw new Error("inventory plan checksum mismatch");
  for (const operation of plan.operations) {
    if (operation?.status !== "window_required" || !operation.variant_gid || !operation.inventory_item_gid) {
      throw new Error("inventory plan operation is invalid");
    }
  }
}
