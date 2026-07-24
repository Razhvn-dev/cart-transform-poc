export const PREBUILT_PARTIAL_REFUND_ACCEPTANCE_SCHEMA_VERSION =
  "prebuilt_partial_refund_acceptance.v1";

export function assessPrebuiltPartialRefundAcceptance(input) {
  if (!isPlainObject(input)) {
    return result("invalid", [
      invalid(
        "INVALID_DOCUMENT",
        "document",
        "partial-refund acceptance evidence must be an object",
      ),
    ]);
  }

  const issues = [];
  validateExactKeys(input, TOP_LEVEL_FIELDS, "document", issues);
  if (
    input.schema_version !== PREBUILT_PARTIAL_REFUND_ACCEPTANCE_SCHEMA_VERSION
  ) {
    issues.push(
      invalid(
        "INVALID_SCHEMA",
        "schema_version",
        `schema_version must be ${PREBUILT_PARTIAL_REFUND_ACCEPTANCE_SCHEMA_VERSION}`,
      ),
    );
  }

  const scope = validateScope(input.refund_scope, issues);
  const evidence = input.evidence;
  if (!isPlainObject(evidence)) {
    issues.push(
      invalid(
        "INVALID_EVIDENCE",
        "evidence",
        "evidence must be a plain object with own properties",
      ),
    );
  } else {
    validateExactKeys(evidence, EVIDENCE_FIELDS, "evidence", issues);
  }
  if (issues.some((item) => item.kind === "invalid")) {
    return result("invalid", issues, scope);
  }

  const remaining =
    scope.expected_ordered_quantity -
    scope.expected_already_refunded_quantity -
    scope.requested_refund_quantity;
  const reconciliation = {
    ordered_quantity: scope.expected_ordered_quantity,
    already_refunded_quantity: scope.expected_already_refunded_quantity,
    requested_refund_quantity: scope.requested_refund_quantity,
    remaining_refundable_quantity: Math.max(0, remaining),
  };

  if (remaining < 0) {
    issues.push(
      failed(
        "OVER_REFUND",
        "refund_scope.requested_refund_quantity",
        "requested refund quantity exceeds the remaining refundable component quantity",
      ),
    );
  }

  assessOrderComponent(evidence.order_component, scope, issues);
  const priorRefundIdentities = assessPriorRefunds(
    evidence.prior_refunds,
    scope,
    issues,
  );
  assessRefund(evidence.refund, scope, priorRefundIdentities, issues);
  assessInventory(evidence.inventory, evidence.refund, scope, issues);

  const status = issues.some((item) => item.kind === "invalid")
    ? "invalid"
    : issues.some((item) => item.kind === "failed")
      ? "failed"
      : issues.some((item) => item.kind === "pending")
        ? "incomplete"
        : "passed";
  return result(status, issues, scope, reconciliation);
}

function validateScope(scope, issues) {
  if (!isPlainObject(scope)) {
    issues.push(
      invalid(
        "INVALID_REFUND_SCOPE",
        "refund_scope",
        "refund_scope must be an object",
      ),
    );
    return null;
  }
  validateExactKeys(scope, REFUND_SCOPE_FIELDS, "refund_scope", issues);

  const identityFields = [
    ["order_gid", ORDER_GID_REGEX],
    ["order_line_item_gid", LINE_ITEM_GID_REGEX],
    ["bundle_instance_id", BUNDLE_INSTANCE_ID_REGEX],
    ["component_variant_gid", PRODUCT_VARIANT_GID_REGEX],
    ["parent_variant_gid", PRODUCT_VARIANT_GID_REGEX],
  ];
  for (const [field, pattern] of identityFields) {
    if (!matchesString(scope[field], pattern)) {
      issues.push(
        invalid(
          "INVALID_REFUND_SCOPE",
          `refund_scope.${field}`,
          `${field} must be the expected Shopify GID`,
        ),
      );
    }
  }
  if (
    matchesString(scope.component_variant_gid, PRODUCT_VARIANT_GID_REGEX) &&
    scope.component_variant_gid === scope.parent_variant_gid
  ) {
    issues.push(
      invalid(
        "PARENT_COMPONENT_IDENTITY_COLLISION",
        "refund_scope.parent_variant_gid",
        "component and parent Variant identities must be different",
      ),
    );
  }

  if (!isPositiveSafeInteger(scope.expected_ordered_quantity)) {
    issues.push(
      invalid(
        "INVALID_REFUND_SCOPE",
        "refund_scope.expected_ordered_quantity",
        "expected_ordered_quantity must be a positive safe integer",
      ),
    );
  }
  if (
    !isNonNegativeSafeInteger(scope.expected_already_refunded_quantity) ||
    (isPositiveSafeInteger(scope.expected_ordered_quantity) &&
      scope.expected_already_refunded_quantity >
        scope.expected_ordered_quantity)
  ) {
    issues.push(
      invalid(
        "INVALID_REFUND_SCOPE",
        "refund_scope.expected_already_refunded_quantity",
        "expected_already_refunded_quantity must be a non-negative safe integer no greater than ordered quantity",
      ),
    );
  }
  if (!isPositiveSafeInteger(scope.requested_refund_quantity)) {
    issues.push(
      invalid(
        "INVALID_REFUND_SCOPE",
        "refund_scope.requested_refund_quantity",
        "requested_refund_quantity must be a positive safe integer",
      ),
    );
  }
  if (!matchesString(scope.currency_code, CURRENCY_CODE_REGEX)) {
    issues.push(
      invalid(
        "INVALID_REFUND_SCOPE",
        "refund_scope.currency_code",
        "currency_code must be a three-letter uppercase currency code",
      ),
    );
  }
  if (!isNonNegativeSafeInteger(scope.fixed_price_per_unit_minor)) {
    issues.push(
      invalid(
        "INVALID_REFUND_SCOPE",
        "refund_scope.fixed_price_per_unit_minor",
        "fixed_price_per_unit_minor must be a non-negative safe integer",
      ),
    );
  } else if (
    isPositiveSafeInteger(scope.requested_refund_quantity) &&
    !Number.isSafeInteger(
      scope.fixed_price_per_unit_minor * scope.requested_refund_quantity,
    )
  ) {
    issues.push(
      invalid(
        "UNSAFE_COMPONENT_SUBTOTAL",
        "refund_scope.fixed_price_per_unit_minor",
        "requested quantity multiplied by fixed unit price must remain a safe integer",
      ),
    );
  }
  if (typeof scope.restock_requested !== "boolean") {
    issues.push(
      invalid(
        "INVALID_REFUND_SCOPE",
        "refund_scope.restock_requested",
        "restock_requested must be a boolean",
      ),
    );
  }

  if (issues.some((item) => item.kind === "invalid")) return null;
  return Object.freeze({
    order_gid: scope.order_gid,
    order_line_item_gid: scope.order_line_item_gid,
    bundle_instance_id: scope.bundle_instance_id,
    component_variant_gid: scope.component_variant_gid,
    parent_variant_gid: scope.parent_variant_gid,
    currency_code: scope.currency_code,
    fixed_price_per_unit_minor: scope.fixed_price_per_unit_minor,
    expected_ordered_quantity: scope.expected_ordered_quantity,
    expected_already_refunded_quantity:
      scope.expected_already_refunded_quantity,
    requested_refund_quantity: scope.requested_refund_quantity,
    restock_requested: scope.restock_requested,
  });
}

function assessOrderComponent(orderComponent, scope, issues) {
  if (orderComponent == null) {
    issues.push(
      pending(
        "ORDER_COMPONENT_EVIDENCE_REQUIRED",
        "evidence.order_component",
        "capture Shopify Order component identity and quantity read-back",
      ),
    );
    return;
  }
  if (!isPlainObject(orderComponent)) {
    issues.push(
      invalid(
        "INVALID_ORDER_COMPONENT_EVIDENCE",
        "evidence.order_component",
        "Order component evidence must be a plain object",
      ),
    );
    return;
  }
  validateExactKeys(
    orderComponent,
    ORDER_COMPONENT_FIELDS,
    "evidence.order_component",
    issues,
  );
  if (
    !hasOwnFields(orderComponent, ORDER_COMPONENT_FIELDS) ||
    !matchesString(orderComponent.order_gid, ORDER_GID_REGEX) ||
    !matchesString(orderComponent.order_line_item_gid, LINE_ITEM_GID_REGEX) ||
    !matchesString(
      orderComponent.bundle_instance_id,
      BUNDLE_INSTANCE_ID_REGEX,
    ) ||
    !matchesString(orderComponent.variant_gid, PRODUCT_VARIANT_GID_REGEX) ||
    !matchesString(
      orderComponent.parent_variant_gid,
      PRODUCT_VARIANT_GID_REGEX,
    ) ||
    !isPositiveSafeInteger(orderComponent.ordered_quantity) ||
    !isNonNegativeSafeInteger(orderComponent.already_refunded_quantity)
  ) {
    issues.push(
      invalid(
        "INVALID_ORDER_COMPONENT_EVIDENCE",
        "evidence.order_component",
        "Order component evidence fields must match their schema types",
      ),
    );
    return;
  }

  if (
    orderComponent.order_gid !== scope.order_gid ||
    orderComponent.order_line_item_gid !== scope.order_line_item_gid ||
    orderComponent.bundle_instance_id !== scope.bundle_instance_id ||
    orderComponent.variant_gid !== scope.component_variant_gid ||
    orderComponent.parent_variant_gid !== scope.parent_variant_gid
  ) {
    issues.push(
      failed(
        "ORDER_COMPONENT_IDENTITY_MISMATCH",
        "evidence.order_component",
        "Order component evidence must match the accepted Order line and component Variant",
      ),
    );
  }
  if (orderComponent.ordered_quantity !== scope.expected_ordered_quantity) {
    issues.push(
      failed(
        "ORDERED_QUANTITY_MISMATCH",
        "evidence.order_component.ordered_quantity",
        "Shopify ordered quantity must match the accepted component quantity",
      ),
    );
  }
  if (
    orderComponent.already_refunded_quantity !==
    scope.expected_already_refunded_quantity
  ) {
    issues.push(
      failed(
        "ALREADY_REFUNDED_QUANTITY_MISMATCH",
        "evidence.order_component.already_refunded_quantity",
        "Shopify already-refunded quantity must match the accepted refund history",
      ),
    );
  }
}

function assessPriorRefunds(priorRefunds, scope, issues) {
  if (priorRefunds == null) {
    issues.push(
      pending(
        "PRIOR_REFUND_EVIDENCE_REQUIRED",
        "evidence.prior_refunds",
        "capture prior Shopify refund evidence, using an empty array when none exists",
      ),
    );
    return { refundIds: new Set(), transactionIds: new Set() };
  }
  if (!Array.isArray(priorRefunds)) {
    issues.push(
      invalid(
        "INVALID_PRIOR_REFUND_EVIDENCE",
        "evidence.prior_refunds",
        "prior_refunds must be an array",
      ),
    );
    return { refundIds: new Set(), transactionIds: new Set() };
  }

  const refundIds = new Set();
  const transactionIds = new Set();
  let totalQuantity = 0;
  let validQuantityEvidence = true;
  priorRefunds.forEach((refund, index) => {
    const path = `evidence.prior_refunds[${index}]`;
    if (
      !isPlainObject(refund) ||
      !hasOwnFields(refund, PRIOR_REFUND_FIELDS) ||
      !matchesString(refund.refund_gid, REFUND_GID_REGEX) ||
      !matchesString(
        refund.refund_transaction_gid,
        ORDER_TRANSACTION_GID_REGEX,
      ) ||
      !matchesString(refund.order_gid, ORDER_GID_REGEX) ||
      !matchesString(refund.order_line_item_gid, LINE_ITEM_GID_REGEX) ||
      !matchesString(refund.bundle_instance_id, BUNDLE_INSTANCE_ID_REGEX) ||
      !isPositiveSafeInteger(refund.quantity)
    ) {
      issues.push(
        invalid(
          "INVALID_PRIOR_REFUND_EVIDENCE",
          path,
          "prior refund evidence requires Refund and LineItem GIDs plus a positive safe-integer quantity",
        ),
      );
      validQuantityEvidence = false;
      return;
    }
    validateExactKeys(refund, PRIOR_REFUND_FIELDS, path, issues);
    if (
      refundIds.has(refund.refund_gid) ||
      transactionIds.has(refund.refund_transaction_gid)
    ) {
      issues.push(
        failed(
          "DUPLICATE_REFUND_EVIDENCE",
          `${path}.refund_gid`,
          "each Shopify Refund GID may appear only once",
        ),
      );
    } else {
      refundIds.add(refund.refund_gid);
      transactionIds.add(refund.refund_transaction_gid);
    }
    if (
      refund.order_gid !== scope.order_gid ||
      refund.order_line_item_gid !== scope.order_line_item_gid ||
      refund.bundle_instance_id !== scope.bundle_instance_id
    ) {
      issues.push(
        failed(
          "PRIOR_REFUND_COMPONENT_IDENTITY_MISMATCH",
          `${path}.order_line_item_gid`,
          "prior refund evidence must target the accepted Order component line",
        ),
      );
    }
    totalQuantity += refund.quantity;
    if (!Number.isSafeInteger(totalQuantity)) {
      issues.push(
        invalid(
          "INVALID_PRIOR_REFUND_EVIDENCE",
          "evidence.prior_refunds",
          "prior refund quantity total must remain a safe integer",
        ),
      );
      validQuantityEvidence = false;
    }
  });

  if (
    validQuantityEvidence &&
    totalQuantity !== scope.expected_already_refunded_quantity
  ) {
    issues.push(
      failed(
        "PRIOR_REFUND_QUANTITY_MISMATCH",
        "evidence.prior_refunds",
        "unique prior refund quantities must equal expected_already_refunded_quantity",
      ),
    );
  }
  return { refundIds, transactionIds };
}

function assessRefund(refund, scope, priorRefundIdentities, issues) {
  if (refund == null) {
    issues.push(
      pending(
        "REFUND_EVIDENCE_REQUIRED",
        "evidence.refund",
        "capture the Shopify refund line and calculated amount read-back",
      ),
    );
    return;
  }
  if (!isPlainObject(refund)) {
    issues.push(
      invalid(
        "INVALID_REFUND_EVIDENCE",
        "evidence.refund",
        "refund evidence must be a plain object",
      ),
    );
    return;
  }
  validateExactKeys(refund, REFUND_FIELDS, "evidence.refund", issues);
  if (
    !hasOwnFields(refund, REFUND_FIELDS) ||
    !matchesString(refund.refund_gid, REFUND_GID_REGEX) ||
    !matchesString(
      refund.refund_transaction_gid,
      ORDER_TRANSACTION_GID_REGEX,
    ) ||
    !matchesString(refund.order_gid, ORDER_GID_REGEX) ||
    !matchesString(refund.order_line_item_gid, LINE_ITEM_GID_REGEX) ||
    !matchesString(refund.bundle_instance_id, BUNDLE_INSTANCE_ID_REGEX) ||
    !matchesString(refund.variant_gid, PRODUCT_VARIANT_GID_REGEX) ||
    !matchesString(refund.parent_variant_gid, PRODUCT_VARIANT_GID_REGEX) ||
    !isPositiveSafeInteger(refund.quantity)
  ) {
    issues.push(
      invalid(
        "INVALID_REFUND_EVIDENCE",
        "evidence.refund",
        "refund evidence fields must match their schema types",
      ),
    );
    return;
  }

  if (
    priorRefundIdentities.refundIds.has(refund.refund_gid) ||
    priorRefundIdentities.transactionIds.has(refund.refund_transaction_gid)
  ) {
    issues.push(
      failed(
        "DUPLICATE_REFUND_EVIDENCE",
        "evidence.refund.refund_gid",
        "current refund evidence must not duplicate a prior Shopify Refund GID",
      ),
    );
  }
  if (
    refund.order_gid !== scope.order_gid ||
    refund.order_line_item_gid !== scope.order_line_item_gid ||
    refund.bundle_instance_id !== scope.bundle_instance_id ||
    refund.variant_gid !== scope.component_variant_gid ||
    refund.parent_variant_gid !== scope.parent_variant_gid
  ) {
    issues.push(
      failed(
        "REFUND_COMPONENT_IDENTITY_MISMATCH",
        "evidence.refund",
        "refund evidence must target the accepted Order component line",
      ),
    );
  }
  if (refund.quantity !== scope.requested_refund_quantity) {
    issues.push(
      failed(
        "REQUESTED_REFUND_QUANTITY_MISMATCH",
        "evidence.refund.quantity",
        "Shopify refund quantity must match the requested component quantity",
      ),
    );
  }

  assessShopifyAmounts(refund, scope, issues);
}

function assessShopifyAmounts(refund, scope, issues) {
  const calculated = assessShopifyAmount(
    refund.shopify_calculated_amount,
    "shopify_calculated_amount",
    refund,
    scope,
    issues,
  );
  const actual = assessShopifyAmount(
    refund.shopify_actual_amount,
    "shopify_actual_amount",
    refund,
    scope,
    issues,
  );
  if (
    calculated &&
    actual &&
    AMOUNT_COMPARISON_FIELDS.some(
      (field) => calculated[field] !== actual[field],
    )
  ) {
    issues.push(
      failed(
        "SHOPIFY_CALCULATED_ACTUAL_MISMATCH",
        "evidence.refund",
        "Shopify calculated and actual refund allocation read-backs must match exactly",
      ),
    );
  }
}

function assessShopifyAmount(amount, fieldName, refund, scope, issues) {
  if (amount == null) {
    issues.push(
      pending(
        "SHOPIFY_AMOUNT_READBACK_REQUIRED",
        `evidence.refund.${fieldName}`,
        "both Shopify read-backs must include transaction identity, subtotal, discount, tax, shipping, rounding, and total minor units",
      ),
    );
    return null;
  }
  if (!isPlainObject(amount)) {
    issues.push(
      invalid(
        "INVALID_SHOPIFY_AMOUNT_READBACK",
        `evidence.refund.${fieldName}`,
        "Shopify amount read-back must be a plain object",
      ),
    );
    return null;
  }
  validateExactKeys(
    amount,
    SHOPIFY_AMOUNT_FIELDS,
    `evidence.refund.${fieldName}`,
    issues,
  );
  if (
    !hasOwnFields(amount, SHOPIFY_AMOUNT_FIELDS) ||
    typeof amount.source !== "string" ||
    !matchesString(amount.refund_gid, REFUND_GID_REGEX) ||
    !matchesString(
      amount.refund_transaction_gid,
      ORDER_TRANSACTION_GID_REGEX,
    ) ||
    !matchesString(amount.order_gid, ORDER_GID_REGEX) ||
    !matchesString(amount.order_line_item_gid, LINE_ITEM_GID_REGEX) ||
    !matchesString(amount.bundle_instance_id, BUNDLE_INSTANCE_ID_REGEX) ||
    !matchesString(amount.currency_code, CURRENCY_CODE_REGEX) ||
    !isNonNegativeSafeInteger(amount.component_subtotal_minor) ||
    AMOUNT_MINOR_FIELDS.slice(1).some(
      (field) => !Number.isSafeInteger(amount[field]),
    )
  ) {
    issues.push(
      invalid(
        "INVALID_SHOPIFY_AMOUNT_READBACK",
        `evidence.refund.${fieldName}`,
        "Shopify amount read-back fields must match their schema types",
      ),
    );
    return null;
  }

  if (amount.source !== "shopify_readback") {
    issues.push(
      failed(
        "SHOPIFY_AMOUNT_NOT_READ_BACK",
        `evidence.refund.${fieldName}.source`,
        "refund allocations must come from Shopify read-back, not local calculation",
      ),
    );
  }

  if (
    amount.refund_gid !== refund.refund_gid ||
    amount.refund_transaction_gid !== refund.refund_transaction_gid ||
    amount.order_gid !== scope.order_gid ||
    amount.order_line_item_gid !== scope.order_line_item_gid ||
    amount.bundle_instance_id !== scope.bundle_instance_id ||
    amount.currency_code !== scope.currency_code
  ) {
    issues.push(
      failed(
        "SHOPIFY_AMOUNT_IDENTITY_MISMATCH",
        `evidence.refund.${fieldName}`,
        "amount read-back must match the accepted refund transaction, Order line, bundle instance, and currency",
      ),
    );
  }

  const expectedSubtotal =
    scope.requested_refund_quantity * scope.fixed_price_per_unit_minor;
  if (amount.component_subtotal_minor !== expectedSubtotal) {
    issues.push(
      failed(
        "COMPONENT_SUBTOTAL_MISMATCH",
        `evidence.refund.${fieldName}.component_subtotal_minor`,
        "component subtotal must equal requested quantity multiplied by fixed per-unit minor units",
      ),
    );
  }

  const reconciledTotal = checkedAddMinorUnits([
    amount.component_subtotal_minor,
    amount.discount_allocation_minor,
    amount.tax_allocation_minor,
    amount.shipping_allocation_minor,
    amount.rounding_adjustment_minor,
  ]);
  if (reconciledTotal === null) {
    issues.push(
      failed(
        "SHOPIFY_AMOUNT_TOTAL_OVERFLOW",
        `evidence.refund.${fieldName}`,
        "every intermediate signed allocation total must remain a safe integer",
      ),
    );
  } else if (reconciledTotal !== amount.total_minor) {
    issues.push(
      failed(
        "SHOPIFY_AMOUNT_TOTAL_MISMATCH",
        `evidence.refund.${fieldName}.total_minor`,
        "Shopify total must equal the signed allocation read-back contributions",
      ),
    );
  }
  return amount;
}

function checkedAddMinorUnits(values) {
  let total = 0;
  for (const value of values) {
    if (
      (value > 0 && total > Number.MAX_SAFE_INTEGER - value) ||
      (value < 0 && total < Number.MIN_SAFE_INTEGER - value)
    ) {
      return null;
    }
    total += value;
  }
  return total;
}

function assessInventory(inventory, refund, scope, issues) {
  if (inventory == null) {
    issues.push(
      pending(
        "INVENTORY_EVIDENCE_REQUIRED",
        "evidence.inventory",
        "capture component restock and parent inventory delta read-back",
      ),
    );
    return;
  }
  if (!isPlainObject(inventory)) {
    issues.push(
      invalid(
        "INVALID_INVENTORY_EVIDENCE",
        "evidence.inventory",
        "inventory evidence must be a plain object",
      ),
    );
    return;
  }
  validateExactKeys(inventory, INVENTORY_FIELDS, "evidence.inventory", issues);
  if (
    !hasOwnFields(inventory, INVENTORY_FIELDS) ||
    !matchesString(inventory.refund_gid, REFUND_GID_REGEX) ||
    !matchesString(
      inventory.refund_transaction_gid,
      ORDER_TRANSACTION_GID_REGEX,
    ) ||
    !matchesString(inventory.order_gid, ORDER_GID_REGEX) ||
    !matchesString(inventory.order_line_item_gid, LINE_ITEM_GID_REGEX) ||
    !matchesString(inventory.bundle_instance_id, BUNDLE_INSTANCE_ID_REGEX) ||
    !matchesString(
      inventory.component_variant_gid,
      PRODUCT_VARIANT_GID_REGEX,
    ) ||
    !matchesString(inventory.parent_variant_gid, PRODUCT_VARIANT_GID_REGEX) ||
    !matchesString(inventory.location_gid, LOCATION_GID_REGEX) ||
    !matchesString(
      inventory.inventory_adjustment_gid,
      INVENTORY_ADJUSTMENT_GID_REGEX,
    ) ||
    !isNonNegativeSafeInteger(inventory.component_before_quantity) ||
    !isNonNegativeSafeInteger(inventory.component_after_quantity) ||
    !isNonNegativeSafeInteger(inventory.component_restock_delta) ||
    !isNonNegativeSafeInteger(inventory.parent_before_quantity) ||
    !isNonNegativeSafeInteger(inventory.parent_after_quantity) ||
    !Number.isSafeInteger(inventory.parent_delta)
  ) {
    issues.push(
      invalid(
        "INVALID_INVENTORY_EVIDENCE",
        "evidence.inventory",
        "inventory evidence fields must match their schema types",
      ),
    );
    return;
  }

  if (
    inventory.component_variant_gid !== scope.component_variant_gid ||
    inventory.parent_variant_gid !== scope.parent_variant_gid
  ) {
    issues.push(
      failed(
        "INVENTORY_IDENTITY_MISMATCH",
        "evidence.inventory",
        "inventory evidence must identify the accepted component and parent Variants",
      ),
    );
  }
  if (
    !isPlainObject(refund) ||
    inventory.refund_gid !== refund.refund_gid ||
    inventory.refund_transaction_gid !== refund.refund_transaction_gid ||
    inventory.order_gid !== scope.order_gid ||
    inventory.order_line_item_gid !== scope.order_line_item_gid ||
    inventory.bundle_instance_id !== scope.bundle_instance_id
  ) {
    issues.push(
      failed(
        "INVENTORY_REFUND_IDENTITY_MISMATCH",
        "evidence.inventory",
        "inventory read-back must bind to the accepted refund transaction, Order line, and bundle instance",
      ),
    );
  }

  const expectedRestockDelta = scope.restock_requested
    ? scope.requested_refund_quantity
    : 0;
  if (inventory.component_restock_delta !== expectedRestockDelta) {
    issues.push(
      failed(
        "COMPONENT_RESTOCK_MISMATCH",
        "evidence.inventory.component_restock_delta",
        "component restock delta must exactly match the refunded quantity when restock is requested, otherwise zero",
      ),
    );
  }
  if (inventory.parent_delta !== 0) {
    issues.push(
      failed(
        "PARENT_INVENTORY_CHANGED",
        "evidence.inventory.parent_delta",
        "parent Variant inventory delta must remain zero",
      ),
    );
  }
  if (
    inventory.component_after_quantity - inventory.component_before_quantity !==
    inventory.component_restock_delta
  ) {
    issues.push(
      failed(
        "COMPONENT_INVENTORY_READBACK_MISMATCH",
        "evidence.inventory",
        "component before and after quantities must prove the reported restock delta",
      ),
    );
  }
  if (
    inventory.parent_after_quantity - inventory.parent_before_quantity !==
    inventory.parent_delta
  ) {
    issues.push(
      failed(
        "PARENT_INVENTORY_READBACK_MISMATCH",
        "evidence.inventory",
        "parent before and after quantities must prove the zero inventory delta",
      ),
    );
  }
}

function result(status, issues, scope = null, reconciliation = null) {
  return deepFreeze({
    schema_version: PREBUILT_PARTIAL_REFUND_ACCEPTANCE_SCHEMA_VERSION,
    status,
    accepted: status === "passed",
    refund_scope: scope,
    reconciliation,
    summary: {
      failed: issues.filter((item) => item.kind === "failed").length,
      pending: issues.filter((item) => item.kind === "pending").length,
      invalid: issues.filter((item) => item.kind === "invalid").length,
    },
    issues,
  });
}

function issue(code, path, message, kind) {
  return { code, path, message, kind };
}

function invalid(code, path, message) {
  return issue(code, path, message, "invalid");
}

function pending(code, path, message) {
  return issue(code, path, message, "pending");
}

function failed(code, path, message) {
  return issue(code, path, message, "failed");
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateExactKeys(value, allowedFields, path, issues) {
  const allowed = new Set(allowedFields);
  Object.keys(value)
    .filter((field) => !allowed.has(field))
    .sort()
    .forEach((field) => {
      issues.push(
        invalid(
          "UNKNOWN_FIELD",
          `${path}.${field}`,
          "unknown fields are not allowed by the acceptance schema",
        ),
      );
    });
}

function hasOwnFields(value, fields) {
  return fields.every((field) => Object.hasOwn(value, field));
}

function matchesString(value, pattern) {
  return typeof value === "string" && pattern.test(value);
}

function isPlainObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const ORDER_GID_REGEX = /^gid:\/\/shopify\/Order\/[0-9]+$/;
const LINE_ITEM_GID_REGEX = /^gid:\/\/shopify\/LineItem\/[0-9]+$/;
const PRODUCT_VARIANT_GID_REGEX = /^gid:\/\/shopify\/ProductVariant\/[0-9]+$/;
const REFUND_GID_REGEX = /^gid:\/\/shopify\/Refund\/[0-9]+$/;
const ORDER_TRANSACTION_GID_REGEX =
  /^gid:\/\/shopify\/OrderTransaction\/[0-9]+$/;
const BUNDLE_INSTANCE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY_CODE_REGEX = /^[A-Z]{3}$/;
const LOCATION_GID_REGEX = /^gid:\/\/shopify\/Location\/[0-9]+$/;
const INVENTORY_ADJUSTMENT_GID_REGEX =
  /^gid:\/\/shopify\/InventoryAdjustmentGroup\/[0-9]+$/;
const TOP_LEVEL_FIELDS = ["schema_version", "refund_scope", "evidence"];
const REFUND_SCOPE_FIELDS = [
  "order_gid",
  "order_line_item_gid",
  "bundle_instance_id",
  "component_variant_gid",
  "parent_variant_gid",
  "currency_code",
  "fixed_price_per_unit_minor",
  "expected_ordered_quantity",
  "expected_already_refunded_quantity",
  "requested_refund_quantity",
  "restock_requested",
];
const EVIDENCE_FIELDS = [
  "order_component",
  "prior_refunds",
  "refund",
  "inventory",
];
const ORDER_COMPONENT_FIELDS = [
  "order_gid",
  "order_line_item_gid",
  "bundle_instance_id",
  "variant_gid",
  "parent_variant_gid",
  "ordered_quantity",
  "already_refunded_quantity",
];
const PRIOR_REFUND_FIELDS = [
  "refund_gid",
  "refund_transaction_gid",
  "order_gid",
  "order_line_item_gid",
  "bundle_instance_id",
  "quantity",
];
const REFUND_FIELDS = [
  "refund_gid",
  "refund_transaction_gid",
  "order_gid",
  "order_line_item_gid",
  "bundle_instance_id",
  "variant_gid",
  "parent_variant_gid",
  "quantity",
  "shopify_calculated_amount",
  "shopify_actual_amount",
];
const AMOUNT_MINOR_FIELDS = [
  "component_subtotal_minor",
  "discount_allocation_minor",
  "tax_allocation_minor",
  "shipping_allocation_minor",
  "rounding_adjustment_minor",
  "total_minor",
];
const SHOPIFY_AMOUNT_FIELDS = [
  "source",
  "refund_gid",
  "refund_transaction_gid",
  "order_gid",
  "order_line_item_gid",
  "bundle_instance_id",
  "currency_code",
  ...AMOUNT_MINOR_FIELDS,
];
const AMOUNT_COMPARISON_FIELDS = ["currency_code", ...AMOUNT_MINOR_FIELDS];
const INVENTORY_FIELDS = [
  "refund_gid",
  "refund_transaction_gid",
  "order_gid",
  "order_line_item_gid",
  "bundle_instance_id",
  "component_variant_gid",
  "location_gid",
  "inventory_adjustment_gid",
  "component_before_quantity",
  "component_after_quantity",
  "component_restock_delta",
  "parent_variant_gid",
  "parent_before_quantity",
  "parent_after_quantity",
  "parent_delta",
];
