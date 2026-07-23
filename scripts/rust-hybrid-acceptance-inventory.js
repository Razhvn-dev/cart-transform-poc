import { planDevCatalogAcceptanceInventoryWindows } from "./dev-catalog-acceptance-inventory-plan.js";
import { prepareDevCatalogAcceptanceInventoryMutationScope } from "./dev-catalog-acceptance-inventory-execution.js";

const DEV_STORE = "huang-mvqquz1p.myshopify.com";
const CATALOG_SCHEMA_VERSION = "dev_catalog_technical_batch_live_readback.v2";
const PRODUCT_VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const INVENTORY_ITEM_GID = /^gid:\/\/shopify\/InventoryItem\/\d+$/;
const RETIRED_ACCEPTANCE_WINDOW_IDS = Object.freeze([
  "v66-rust-hybrid-checkout-1",
  "v67-rust-hybrid-checkout-1",
]);
const RETIRED_ACCEPTANCE_BATCH_ID = "rust-hybrid-v66-hosted-acceptance";

export const BUILDER_STANDARD_INVENTORY_READBACK_SCHEMA_VERSION =
  "rust_hybrid_builder_component_inventory_readback.v1";
export const RUST_HYBRID_ACCEPTANCE_WINDOW_ID = "v67-rust-hybrid-checkout-2";
export const RUST_HYBRID_ACCEPTANCE_BATCH_ID =
  "rust-hybrid-v67-hosted-acceptance";

export const BUILDER_STANDARD_COMPONENTS = Object.freeze({
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

const PREBUILT_PARENTS = Object.freeze({
  "AS2014B-BT": "gid://shopify/ProductVariant/51592723333398",
  "AS2014B2-FK-4005P": "gid://shopify/ProductVariant/51592541503766",
  "AS2014B2-MK-2011-4005P": "gid://shopify/ProductVariant/51592577089814",
});

export function planRustHybridAcceptanceInventory({
  catalogReadback,
  builderReadback,
} = {}) {
  validateReadbackEnvelope(
    catalogReadback,
    "catalogReadback",
    CATALOG_SCHEMA_VERSION,
  );
  validateReadbackEnvelope(
    builderReadback,
    "builderReadback",
    BUILDER_STANDARD_INVENTORY_READBACK_SCHEMA_VERSION,
  );

  const excludedParentIds = new Set(Object.values(PREBUILT_PARENTS));
  const selectedByVariant = new Map();
  const catalogByParentSku = uniqueBy(
    catalogReadback.records,
    (record) => record?.parent_sku,
    "catalogReadback.records parent_sku",
  );

  for (const [parentSku, expectedVariantId] of Object.entries(PREBUILT_PARENTS)) {
    const record = catalogByParentSku.get(parentSku);
    if (record == null) {
      throw new Error(`catalogReadback is missing required parent ${parentSku}`);
    }
    const observedParentVariantId = requiredString(
      record?.parent?.live?.variant_gid,
      `catalogReadback parent ${parentSku}.live.variant_gid`,
    );
    if (observedParentVariantId !== expectedVariantId) {
      throw new Error(
        `catalogReadback parent ${parentSku} Variant identity mismatch: ${observedParentVariantId}`,
      );
    }
    if (!Array.isArray(record.components) || record.components.length === 0) {
      throw new Error(`catalogReadback parent ${parentSku}.components is required`);
    }
    record.components.forEach((component, index) => {
      addSelectedTarget({
        selectedByVariant,
        excludedParentIds,
        target: normalizeComponent(
          component,
          `catalogReadback parent ${parentSku}.components[${index}]`,
        ),
        source: `prebuilt:${parentSku}`,
      });
    });
  }

  const builderByVariant = uniqueBy(
    builderReadback.records.map((record, index) => normalizeComponent(
      record,
      `builderReadback.records[${index}]`,
    )),
    (record) => record.live.variant_gid,
    "builderReadback.records Variant identity",
  );
  for (const component of Object.values(BUILDER_STANDARD_COMPONENTS)) {
    const target = builderByVariant.get(component.variant_gid);
    if (target == null) {
      throw new Error(`missing Builder Standard component ${component.variant_gid}`);
    }
    if (target.sku !== component.sku) {
      throw new Error(
        `Builder Standard component ${component.variant_gid} SKU mismatch: ${target.sku}`,
      );
    }
    addSelectedTarget({
      selectedByVariant,
      excludedParentIds,
      target,
      source: "builder:standard",
    });
  }

  const selectedTargets = [...selectedByVariant.values()]
    .sort((left, right) => (
      left.target.sku.localeCompare(right.target.sku, "en")
      || left.target.live.variant_gid.localeCompare(right.target.live.variant_gid, "en")
    ));
  const scopedReadback = {
    schema_version: CATALOG_SCHEMA_VERSION,
    mode: "local_union_from_fresh_readbacks",
    store_domain: DEV_STORE,
    batch_id: RUST_HYBRID_ACCEPTANCE_BATCH_ID,
    records: [{
      parent_sku: "rust-hybrid-v67-component-union",
      parent: null,
      components: selectedTargets.map(({ target }) => target),
    }],
    shopify_writes_performed: false,
  };
  const inventoryPlan = planDevCatalogAcceptanceInventoryWindows({
    liveReadback: scopedReadback,
  });
  const openScope = prepareDevCatalogAcceptanceInventoryMutationScope({
    planChecksum: inventoryPlan.checksum,
    phase: "open",
    windowId: RUST_HYBRID_ACCEPTANCE_WINDOW_ID,
  });
  const restoreScope = prepareDevCatalogAcceptanceInventoryMutationScope({
    planChecksum: inventoryPlan.checksum,
    phase: "restore",
    windowId: RUST_HYBRID_ACCEPTANCE_WINDOW_ID,
  });

  return {
    schema_version: "rust_hybrid_acceptance_inventory_plan.v1",
    mode: "local_plan_only",
    store_domain: DEV_STORE,
    window_id: RUST_HYBRID_ACCEPTANCE_WINDOW_ID,
    plan_checksum: inventoryPlan.checksum,
    selected: selectedTargets.map(({ target, sources }) => ({
      sku: target.sku,
      variant_gid: target.live.variant_gid,
      inventory_item_gid: target.live.inventory_item_gid,
      inventory_policy: target.live.inventory_policy,
      available: target.live.inventory_available,
      on_hand: target.live.inventory_on_hand,
      sellable_online_quantity: target.live.sellable_online_quantity,
      sources: [...sources].sort(),
    })),
    excluded_parent_variant_ids: [...excludedParentIds].sort(),
    no_action: inventoryPlan.no_action,
    blocked: inventoryPlan.blockers,
    complete: inventoryPlan.complete,
    execution_confirmations: {
      open: openScope.confirmation,
      restore: restoreScope.confirmation,
    },
    inventory_plan: inventoryPlan,
    shopify_writes_performed: false,
  };
}

export function buildRustHybridAcceptanceExecutorArguments({
  execute,
  phase,
  confirmation,
  planPath,
  result,
} = {}) {
  if (execute !== true) {
    throw new Error("inventory execution requires explicit --execute");
  }
  const retiredWindowId = RETIRED_ACCEPTANCE_WINDOW_IDS.find(
    (windowId) => result?.window_id === windowId
      || (typeof confirmation === "string" && confirmation.includes(windowId)),
  );
  if (retiredWindowId != null) {
    throw new Error(
      `retired acceptance window ${retiredWindowId} is inactive`,
    );
  }
  if (result?.inventory_plan?.batch_id === RETIRED_ACCEPTANCE_BATCH_ID) {
    throw new Error(
      `retired acceptance batch ${RETIRED_ACCEPTANCE_BATCH_ID} is inactive`,
    );
  }
  if (result?.window_id != null
    && result.window_id !== RUST_HYBRID_ACCEPTANCE_WINDOW_ID) {
    throw new Error(
      `inventory execution window must be ${RUST_HYBRID_ACCEPTANCE_WINDOW_ID}`,
    );
  }
  if (result?.inventory_plan?.batch_id != null
    && result.inventory_plan.batch_id !== RUST_HYBRID_ACCEPTANCE_BATCH_ID) {
    throw new Error(
      `inventory execution batch must be ${RUST_HYBRID_ACCEPTANCE_BATCH_ID}`,
    );
  }
  if (!["open", "restore"].includes(phase)) {
    throw new Error("inventory execution phase must be open or restore");
  }
  if (typeof planPath !== "string" || planPath.trim() === "") {
    throw new Error("inventory execution plan path is required");
  }
  if (result?.complete === false) {
    throw new Error("inventory execution is blocked by the current plan");
  }
  const expectedConfirmation = result?.execution_confirmations?.[phase];
  if (expectedConfirmation != null && confirmation !== expectedConfirmation) {
    throw new Error(`inventory execution confirmation mismatch for ${phase}`);
  }
  const confirmationPattern = new RegExp(
    `^APPLY_DEV_INVENTORY_WINDOW:[0-9a-f]{8}:${phase}:${RUST_HYBRID_ACCEPTANCE_WINDOW_ID}$`,
  );
  if (typeof confirmation !== "string" || !confirmationPattern.test(confirmation)) {
    throw new Error(`inventory execution confirmation mismatch for ${phase}`);
  }

  return [
    "scripts/execute-dev-catalog-acceptance-inventory-window.mjs",
    "--plan",
    planPath,
    "--phase",
    phase,
    "--apply",
    "--window-id",
    RUST_HYBRID_ACCEPTANCE_WINDOW_ID,
    "--confirm",
    confirmation,
  ];
}

function validateReadbackEnvelope(readback, label, schemaVersion) {
  if (readback?.schema_version !== schemaVersion) {
    throw new Error(`${label}.schema_version must be ${schemaVersion}`);
  }
  if (readback.store_domain !== DEV_STORE) {
    throw new Error(`${label}.store_domain must be ${DEV_STORE}`);
  }
  if (!Array.isArray(readback.records)) {
    throw new Error(`${label}.records is required`);
  }
  if (readback.shopify_writes_performed !== false) {
    throw new Error(`${label}.shopify_writes_performed must be false`);
  }
}

function normalizeComponent(component, path) {
  const sku = requiredString(component?.sku, `${path}.sku`);
  const variantId = requiredString(component?.live?.variant_gid, `${path}.live.variant_gid`);
  const inventoryItemId = requiredString(
    component?.live?.inventory_item_gid,
    `${path}.live.inventory_item_gid`,
  );
  if (!PRODUCT_VARIANT_GID.test(variantId)) {
    throw new Error(`${path}.live.variant_gid is invalid`);
  }
  if (RETIRED_BUILDER_VARIANT_IDS.has(variantId)) {
    throw new Error(`retired Builder ProductVariant ${variantId} is not accepted`);
  }
  if (!INVENTORY_ITEM_GID.test(inventoryItemId)) {
    throw new Error(`${path}.live.inventory_item_gid is invalid`);
  }
  const inventoryTracked = requiredBoolean(
    component?.live?.inventory_tracked,
    `${path}.live.inventory_tracked`,
  );
  const inventoryPolicy = requiredString(
    component?.live?.inventory_policy,
    `${path}.live.inventory_policy`,
  );
  const inventoryAvailable = requiredInteger(
    component?.live?.inventory_available,
    `${path}.live.inventory_available`,
  );
  const inventoryOnHand = requiredInteger(
    component?.live?.inventory_on_hand,
    `${path}.live.inventory_on_hand`,
  );
  const sellableOnlineQuantity = requiredInteger(
    component?.live?.sellable_online_quantity,
    `${path}.live.sellable_online_quantity`,
  );
  return {
    sku,
    role: "component",
    live: {
      variant_gid: variantId,
      inventory_item_gid: inventoryItemId,
      inventory_tracked: inventoryTracked,
      inventory_policy: inventoryPolicy,
      inventory_available: inventoryAvailable,
      inventory_on_hand: inventoryOnHand,
      sellable_online_quantity: sellableOnlineQuantity,
    },
  };
}

function addSelectedTarget({
  selectedByVariant,
  excludedParentIds,
  target,
  source,
}) {
  const variantId = target.live.variant_gid;
  if (excludedParentIds.has(variantId)) return;
  const existing = selectedByVariant.get(variantId);
  if (existing == null) {
    selectedByVariant.set(variantId, {
      target,
      sources: new Set([source]),
      signature: JSON.stringify(target),
    });
    return;
  }
  if (existing.signature !== JSON.stringify(target)) {
    throw new Error(`inventory read-back conflict for ${variantId}`);
  }
  existing.sources.add(source);
}

function uniqueBy(values, keyOf, label) {
  const result = new Map();
  for (const value of values) {
    const key = keyOf(value);
    if (typeof key !== "string" || key.trim() === "") {
      throw new Error(`${label} is required`);
    }
    if (result.has(key)) {
      throw new Error(`${label} contains duplicate ${key}`);
    }
    result.set(key, value);
  }
  return result;
}

function requiredString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} is required`);
  }
  return value;
}

function requiredBoolean(value, path) {
  if (typeof value !== "boolean") {
    throw new Error(`${path} is required`);
  }
  return value;
}

function requiredInteger(value, path) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${path} is required`);
  }
  return value;
}
