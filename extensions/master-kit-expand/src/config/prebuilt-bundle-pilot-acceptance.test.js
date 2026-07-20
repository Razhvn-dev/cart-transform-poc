import { describe, expect, it } from "vitest";

import { assessPrebuiltBundlePilotAcceptance } from "./prebuilt-bundle-pilot-acceptance.js";

const parent = "gid://shopify/ProductVariant/100";
const componentA = "gid://shopify/ProductVariant/201";
const componentB = "gid://shopify/ProductVariant/202";

function evidence() {
  return {
    schema_version: "prebuilt_bundle_pilot_acceptance.v1",
    pilot_scope: {
      store_domain: "huang-mvqquz1p.myshopify.com",
      product_series_key: "efi",
      parent_variant_gid: parent,
      bundle_quantity: 2,
      expected_components: [
        { variant_gid: componentA, quantity: 1 },
        { variant_gid: componentB, quantity: 2 },
      ],
    },
    evidence: {
      cart: {
        parent_variant_gid: parent,
        parent_line_count: 1,
        parent_quantity: 2,
        component_line_count: 0,
        bundle_metadata_v1_present: true,
      },
      checkout: {
        components: [
          { variant_gid: componentA, quantity: 2 },
          { variant_gid: componentB, quantity: 4 },
        ],
        total_matches_expected: true,
      },
      order: {
        components: [
          { variant_gid: componentA, quantity: 2 },
          { variant_gid: componentB, quantity: 4 },
        ],
        total_matches_expected: true,
      },
      inventory: {
        parent_variant_gid: parent,
        parent_delta: 0,
        component_deltas: [
          { variant_gid: componentA, delta: -2 },
          { variant_gid: componentB, delta: -4 },
        ],
      },
      fulfillment: { decision: "main_sku_only", observed_and_accepted: true },
      rollback: { known_good_version: "40", procedure_documented: true, regression_verified: true },
    },
  };
}

describe("pre-built Bundle pilot acceptance", () => {
  it("passes only exact Cart, Checkout, Order, inventory, fulfillment, and rollback evidence", () => {
    const result = assessPrebuiltBundlePilotAcceptance(evidence());
    expect(result).toMatchObject({ status: "passed", accepted: true, summary: { failed: 0, pending: 0, invalid: 0 } });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("keeps a structurally valid pilot incomplete while live evidence and the Collective decision are missing", () => {
    const input = evidence();
    input.evidence = { fulfillment: { decision: "unresolved" } };
    const result = assessPrebuiltBundlePilotAcceptance(input);
    expect(result).toMatchObject({ status: "incomplete", accepted: false });
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "CART_EVIDENCE_REQUIRED",
      "CHECKOUT_EVIDENCE_REQUIRED",
      "ORDER_EVIDENCE_REQUIRED",
      "INVENTORY_EVIDENCE_REQUIRED",
      "FULFILLMENT_DECISION_REQUIRED",
      "ROLLBACK_EVIDENCE_REQUIRED",
    ]));
  });

  it("fails mismatched component quantities and any parent inventory deduction", () => {
    const input = evidence();
    input.evidence.checkout.components[0].quantity = 1;
    input.evidence.inventory.parent_delta = -2;
    const result = assessPrebuiltBundlePilotAcceptance(input);
    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "CHECKOUT_COMPONENT_MISMATCH",
      "PARENT_INVENTORY_CHANGED",
    ]));
  });

  it("rejects invalid pilot identity and duplicate expected components before evaluating evidence", () => {
    const input = evidence();
    input.pilot_scope.parent_variant_gid = "not-a-gid";
    input.pilot_scope.expected_components.push({ variant_gid: componentA, quantity: 1 });
    const result = assessPrebuiltBundlePilotAcceptance(input);
    expect(result).toMatchObject({ status: "invalid", accepted: false, summary: { invalid: 2 } });
  });
});
