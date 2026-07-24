import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { assessPrebuiltPartialRefundAcceptance } from "./prebuilt-partial-refund-acceptance.js";

const orderGid = "gid://shopify/Order/100";
const orderLineItemGid = "gid://shopify/LineItem/200";
const componentVariantGid = "gid://shopify/ProductVariant/300";
const parentVariantGid = "gid://shopify/ProductVariant/400";
const refundGid = "gid://shopify/Refund/500";
const refundTransactionGid = "gid://shopify/OrderTransaction/501";
const bundleInstanceId = "11111111-1111-4111-8111-111111111111";
const locationGid = "gid://shopify/Location/600";
const inventoryAdjustmentGid = "gid://shopify/InventoryAdjustmentGroup/700";
const schema = JSON.parse(
  readFileSync(
    new URL(
      "../docs/schemas/prebuilt-partial-refund-acceptance.v1.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function evidence({
  orderedQuantity = 4,
  alreadyRefundedQuantity = 0,
  requestedRefundQuantity = 1,
  priorRefunds = [],
  fixedPricePerUnitMinor = 2500,
  restockRequested = true,
} = {}) {
  const componentRestockDelta = restockRequested ? requestedRefundQuantity : 0;
  const amount = {
    source: "shopify_readback",
    refund_gid: refundGid,
    refund_transaction_gid: refundTransactionGid,
    order_gid: orderGid,
    order_line_item_gid: orderLineItemGid,
    bundle_instance_id: bundleInstanceId,
    currency_code: "USD",
    component_subtotal_minor: requestedRefundQuantity * fixedPricePerUnitMinor,
    discount_allocation_minor: 0,
    tax_allocation_minor: 0,
    shipping_allocation_minor: 0,
    rounding_adjustment_minor: 0,
    total_minor: requestedRefundQuantity * fixedPricePerUnitMinor,
  };
  return {
    schema_version: "prebuilt_partial_refund_acceptance.v1",
    refund_scope: {
      order_gid: orderGid,
      order_line_item_gid: orderLineItemGid,
      bundle_instance_id: bundleInstanceId,
      component_variant_gid: componentVariantGid,
      parent_variant_gid: parentVariantGid,
      currency_code: "USD",
      fixed_price_per_unit_minor: fixedPricePerUnitMinor,
      expected_ordered_quantity: orderedQuantity,
      expected_already_refunded_quantity: alreadyRefundedQuantity,
      requested_refund_quantity: requestedRefundQuantity,
      restock_requested: restockRequested,
    },
    evidence: {
      order_component: {
        order_gid: orderGid,
        order_line_item_gid: orderLineItemGid,
        bundle_instance_id: bundleInstanceId,
        variant_gid: componentVariantGid,
        parent_variant_gid: parentVariantGid,
        ordered_quantity: orderedQuantity,
        already_refunded_quantity: alreadyRefundedQuantity,
      },
      prior_refunds: priorRefunds,
      refund: {
        refund_gid: refundGid,
        refund_transaction_gid: refundTransactionGid,
        order_gid: orderGid,
        order_line_item_gid: orderLineItemGid,
        bundle_instance_id: bundleInstanceId,
        variant_gid: componentVariantGid,
        parent_variant_gid: parentVariantGid,
        quantity: requestedRefundQuantity,
        shopify_calculated_amount: { ...amount },
        shopify_actual_amount: { ...amount },
      },
      inventory: {
        refund_gid: refundGid,
        refund_transaction_gid: refundTransactionGid,
        order_gid: orderGid,
        order_line_item_gid: orderLineItemGid,
        bundle_instance_id: bundleInstanceId,
        component_variant_gid: componentVariantGid,
        location_gid: locationGid,
        inventory_adjustment_gid: inventoryAdjustmentGid,
        component_before_quantity: 10,
        component_after_quantity: 10 + componentRestockDelta,
        component_restock_delta: componentRestockDelta,
        parent_variant_gid: parentVariantGid,
        parent_before_quantity: 5,
        parent_after_quantity: 5,
        parent_delta: 0,
      },
    },
  };
}

function priorRefund({
  refundGid: priorRefundGid = "gid://shopify/Refund/490",
  transactionGid = "gid://shopify/OrderTransaction/491",
  quantity,
} = {}) {
  return {
    refund_gid: priorRefundGid,
    refund_transaction_gid: transactionGid,
    order_gid: orderGid,
    order_line_item_gid: orderLineItemGid,
    bundle_instance_id: bundleInstanceId,
    quantity,
  };
}

describe("pre-built partial-refund acceptance", () => {
  it("passes refunding one of N component units with exact component restock and no parent delta", () => {
    const result = assessPrebuiltPartialRefundAcceptance(evidence());

    expect(result).toMatchObject({
      schema_version: "prebuilt_partial_refund_acceptance.v1",
      status: "passed",
      accepted: true,
      reconciliation: {
        ordered_quantity: 4,
        already_refunded_quantity: 0,
        requested_refund_quantity: 1,
        remaining_refundable_quantity: 3,
      },
      summary: { failed: 0, pending: 0, invalid: 0 },
      issues: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("passes refunding several units and reconciles prior refunded quantity", () => {
    const input = evidence({
      orderedQuantity: 8,
      alreadyRefundedQuantity: 1,
      requestedRefundQuantity: 3,
      priorRefunds: [priorRefund({ quantity: 1 })],
    });

    expect(assessPrebuiltPartialRefundAcceptance(input)).toMatchObject({
      status: "passed",
      accepted: true,
      reconciliation: { remaining_refundable_quantity: 4 },
    });
  });

  it("passes refunding the full remaining component quantity", () => {
    const input = evidence({
      orderedQuantity: 8,
      alreadyRefundedQuantity: 3,
      requestedRefundQuantity: 5,
      priorRefunds: [priorRefund({ quantity: 3 })],
    });

    expect(assessPrebuiltPartialRefundAcceptance(input)).toMatchObject({
      status: "passed",
      accepted: true,
      reconciliation: { remaining_refundable_quantity: 0 },
    });
  });

  it("fails duplicate prior or current refund evidence deterministically", () => {
    const input = evidence({
      alreadyRefundedQuantity: 1,
      priorRefunds: [
        priorRefund({
          refundGid,
          transactionGid: refundTransactionGid,
          quantity: 1,
        }),
      ],
    });

    const result = assessPrebuiltPartialRefundAcceptance(input);

    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain(
      "DUPLICATE_REFUND_EVIDENCE",
    );
  });

  it("fails a refund that exceeds the remaining refundable quantity", () => {
    const input = evidence({
      orderedQuantity: 4,
      alreadyRefundedQuantity: 3,
      requestedRefundQuantity: 2,
      priorRefunds: [priorRefund({ quantity: 3 })],
    });

    const result = assessPrebuiltPartialRefundAcceptance(input);

    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain("OVER_REFUND");
  });

  it("keeps structurally valid acceptance incomplete while live read-back evidence is missing", () => {
    const input = evidence();
    input.evidence = {};

    const result = assessPrebuiltPartialRefundAcceptance(input);

    expect(result).toMatchObject({ status: "incomplete", accepted: false });
    expect(result.issues.map((item) => item.code)).toEqual([
      "ORDER_COMPONENT_EVIDENCE_REQUIRED",
      "PRIOR_REFUND_EVIDENCE_REQUIRED",
      "REFUND_EVIDENCE_REQUIRED",
      "INVENTORY_EVIDENCE_REQUIRED",
    ]);
  });

  it("requires every Shopify amount allocation field to be read back", () => {
    const input = evidence();
    input.evidence.refund.shopify_actual_amount = null;

    const result = assessPrebuiltPartialRefundAcceptance(input);

    expect(result).toMatchObject({ status: "incomplete", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain(
      "SHOPIFY_AMOUNT_READBACK_REQUIRED",
    );
  });

  it("requires exact minor-unit subtotal and self-consistent Shopify calculated and actual allocations", () => {
    const localInput = evidence();
    localInput.evidence.refund.shopify_calculated_amount.source =
      "local_calculation";
    const localResult = assessPrebuiltPartialRefundAcceptance(localInput);
    expect(localResult).toMatchObject({ status: "failed", accepted: false });
    expect(localResult.issues.map((item) => item.code)).toContain(
      "SHOPIFY_AMOUNT_NOT_READ_BACK",
    );

    const subtotalMismatch = evidence({ requestedRefundQuantity: 2 });
    subtotalMismatch.evidence.refund.shopify_calculated_amount.component_subtotal_minor = 2500;
    expect(
      assessPrebuiltPartialRefundAcceptance(subtotalMismatch).issues.map(
        (item) => item.code,
      ),
    ).toContain("COMPONENT_SUBTOTAL_MISMATCH");

    const inconsistentTotal = evidence();
    inconsistentTotal.evidence.refund.shopify_calculated_amount.total_minor = 99999;
    expect(
      assessPrebuiltPartialRefundAcceptance(inconsistentTotal).issues.map(
        (item) => item.code,
      ),
    ).toContain("SHOPIFY_AMOUNT_TOTAL_MISMATCH");

    const actualMismatch = evidence();
    actualMismatch.evidence.refund.shopify_actual_amount.tax_allocation_minor = 1;
    expect(
      assessPrebuiltPartialRefundAcceptance(actualMismatch).issues.map(
        (item) => item.code,
      ),
    ).toContain("SHOPIFY_CALCULATED_ACTUAL_MISMATCH");
  });

  it("fails when a signed allocation intermediate total overflows before a later cancellation", () => {
    const input = evidence({
      fixedPricePerUnitMinor: Number.MAX_SAFE_INTEGER,
    });
    for (const amount of [
      input.evidence.refund.shopify_calculated_amount,
      input.evidence.refund.shopify_actual_amount,
    ]) {
      amount.discount_allocation_minor = 1;
      amount.tax_allocation_minor = -1;
      amount.total_minor = Number.MAX_SAFE_INTEGER;
    }

    const result = assessPrebuiltPartialRefundAcceptance(input);

    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain(
      "SHOPIFY_AMOUNT_TOTAL_OVERFLOW",
    );
  });

  it("binds both amount read-backs to the explicit refund transaction", () => {
    const input = evidence();
    input.evidence.refund.shopify_actual_amount.refund_transaction_gid =
      "gid://shopify/OrderTransaction/999";

    const result = assessPrebuiltPartialRefundAcceptance(input);

    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain(
      "SHOPIFY_AMOUNT_IDENTITY_MISMATCH",
    );
  });

  it("fails any component restock delta other than the requested refund quantity", () => {
    const input = evidence({ requestedRefundQuantity: 2 });
    input.evidence.inventory.component_restock_delta = 1;

    const result = assessPrebuiltPartialRefundAcceptance(input);

    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain(
      "COMPONENT_RESTOCK_MISMATCH",
    );
  });

  it("fails any non-zero parent inventory delta", () => {
    for (const parentDelta of [-1, 1]) {
      const input = evidence();
      input.evidence.inventory.parent_delta = parentDelta;

      const result = assessPrebuiltPartialRefundAcceptance(input);

      expect(result).toMatchObject({ status: "failed", accepted: false });
      expect(result.issues.map((item) => item.code)).toContain(
        "PARENT_INVENTORY_CHANGED",
      );
    }
  });

  it("fails mismatched Order, refund, and inventory component identity", () => {
    const input = evidence();
    input.evidence.order_component.order_line_item_gid =
      "gid://shopify/LineItem/999";
    input.evidence.refund.variant_gid = "gid://shopify/ProductVariant/999";
    input.evidence.inventory.component_variant_gid =
      "gid://shopify/ProductVariant/998";

    const result = assessPrebuiltPartialRefundAcceptance(input);

    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "ORDER_COMPONENT_IDENTITY_MISMATCH",
        "REFUND_COMPONENT_IDENTITY_MISMATCH",
        "INVENTORY_IDENTITY_MISMATCH",
      ]),
    );
  });

  it("binds inventory read-back to the same refund, Order line, bundle instance, location, and adjustment", () => {
    const input = evidence();
    input.evidence.inventory.refund_transaction_gid =
      "gid://shopify/OrderTransaction/999";
    input.evidence.inventory.order_line_item_gid = "gid://shopify/LineItem/999";
    input.evidence.inventory.bundle_instance_id =
      "22222222-2222-4222-8222-222222222222";

    const result = assessPrebuiltPartialRefundAcceptance(input);

    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain(
      "INVENTORY_REFUND_IDENTITY_MISMATCH",
    );
  });

  it("requires component and parent before/after inventory read-back to prove each delta", () => {
    const componentInput = evidence();
    componentInput.evidence.inventory.component_after_quantity = 99;
    const componentResult =
      assessPrebuiltPartialRefundAcceptance(componentInput);
    expect(componentResult.issues.map((item) => item.code)).toContain(
      "COMPONENT_INVENTORY_READBACK_MISMATCH",
    );

    const parentInput = evidence();
    parentInput.evidence.inventory.parent_after_quantity = 4;
    const parentResult = assessPrebuiltPartialRefundAcceptance(parentInput);
    expect(parentResult.issues.map((item) => item.code)).toContain(
      "PARENT_INVENTORY_READBACK_MISMATCH",
    );
  });

  it("returns invalid for malformed documents, schema identity, and quantities", () => {
    expect(assessPrebuiltPartialRefundAcceptance(null)).toMatchObject({
      status: "invalid",
      issues: [{ code: "INVALID_DOCUMENT" }],
    });

    const wrongSchema = evidence();
    wrongSchema.schema_version = "unexpected";
    expect(assessPrebuiltPartialRefundAcceptance(wrongSchema)).toMatchObject({
      status: "invalid",
      issues: [{ code: "INVALID_SCHEMA" }],
    });

    const invalidQuantity = evidence();
    invalidQuantity.refund_scope.requested_refund_quantity = 0;
    const invalidResult =
      assessPrebuiltPartialRefundAcceptance(invalidQuantity);
    expect(invalidResult).toMatchObject({ status: "invalid", accepted: false });
    expect(invalidResult.issues.map((item) => item.code)).toContain(
      "INVALID_REFUND_SCOPE",
    );
  });

  it("returns invalid when the component and parent Variant identities are the same", () => {
    const input = evidence();
    input.refund_scope.parent_variant_gid = componentVariantGid;

    const result = assessPrebuiltPartialRefundAcceptance(input);

    expect(result).toMatchObject({ status: "invalid", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain(
      "PARENT_COMPONENT_IDENTITY_COLLISION",
    );
  });

  it("rejects duplicate prior-prior refund evidence", () => {
    const input = evidence({
      alreadyRefundedQuantity: 2,
      priorRefunds: [
        priorRefund({ quantity: 1 }),
        priorRefund({ quantity: 1 }),
      ],
    });

    const result = assessPrebuiltPartialRefundAcceptance(input);

    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain(
      "DUPLICATE_REFUND_EVIDENCE",
    );
  });

  it("rejects a current refund that reuses a prior OrderTransaction GID", () => {
    const input = evidence({
      alreadyRefundedQuantity: 1,
      priorRefunds: [
        priorRefund({
          refundGid: "gid://shopify/Refund/490",
          transactionGid: refundTransactionGid,
          quantity: 1,
        }),
      ],
    });

    const result = assessPrebuiltPartialRefundAcceptance(input);

    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain(
      "DUPLICATE_REFUND_EVIDENCE",
    );
  });

  it("passes no-restock evidence only when the component delta is zero", () => {
    const input = evidence({ restockRequested: false });

    expect(assessPrebuiltPartialRefundAcceptance(input)).toMatchObject({
      status: "passed",
      accepted: true,
    });

    input.evidence.inventory.component_after_quantity = 11;
    input.evidence.inventory.component_restock_delta = 1;
    const result = assessPrebuiltPartialRefundAcceptance(input);
    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain(
      "COMPONENT_RESTOCK_MISMATCH",
    );
  });

  it("returns invalid for unknown keys, wrong types, fake arrays, and inherited evidence", () => {
    const unknownTop = evidence();
    unknownTop.unexpected = true;
    expect(
      assessPrebuiltPartialRefundAcceptance(unknownTop).issues.map(
        (item) => item.code,
      ),
    ).toContain("UNKNOWN_FIELD");

    const unknownNested = evidence();
    unknownNested.evidence.refund.shopify_actual_amount.unexpected = 1;
    expect(
      assessPrebuiltPartialRefundAcceptance(unknownNested).issues.map(
        (item) => item.code,
      ),
    ).toContain("UNKNOWN_FIELD");

    const fakeArray = evidence();
    fakeArray.evidence.prior_refunds = "[]";
    expect(assessPrebuiltPartialRefundAcceptance(fakeArray)).toMatchObject({
      status: "invalid",
    });

    const wrongType = evidence();
    wrongType.evidence.refund.quantity = "1";
    expect(assessPrebuiltPartialRefundAcceptance(wrongType)).toMatchObject({
      status: "invalid",
    });

    const inherited = evidence();
    inherited.evidence.order_component = Object.create(
      inherited.evidence.order_component,
    );
    expect(assessPrebuiltPartialRefundAcceptance(inherited)).toMatchObject({
      status: "invalid",
    });
  });

  it("keeps runtime evidence keys and required schema keys aligned", () => {
    const input = evidence({
      alreadyRefundedQuantity: 1,
      priorRefunds: [priorRefund({ quantity: 1 })],
    });
    const definitions = schema.$defs;
    const pairs = [
      [input.refund_scope, schema.properties.refund_scope],
      [input.evidence.order_component, definitions.orderComponentEvidence],
      [input.evidence.prior_refunds[0], definitions.priorRefundEvidence],
      [input.evidence.refund, definitions.refundEvidence],
      [
        input.evidence.refund.shopify_calculated_amount,
        definitions.shopifyAmountReadback,
      ],
      [input.evidence.inventory, definitions.inventoryEvidence],
    ];

    expect(Object.keys(schema.properties).sort()).toEqual(
      ["schema_version", "refund_scope", "evidence"].sort(),
    );
    for (const [value, objectSchema] of pairs) {
      expect(objectSchema.additionalProperties).toBe(false);
      expect(Object.keys(value).sort()).toEqual(
        [...objectSchema.required].sort(),
      );
      expect(Object.keys(objectSchema.properties).sort()).toEqual(
        [...objectSchema.required].sort(),
      );
    }
  });
});
