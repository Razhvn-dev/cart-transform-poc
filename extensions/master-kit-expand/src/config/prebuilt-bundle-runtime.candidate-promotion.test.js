import { describe, expect, it } from "vitest";

import {
  getPrebuiltCandidateCartLineIds,
  isPrebuiltBundleRuntimeCandidateComplete,
  promotePrebuiltBundleRuntimeCandidate,
} from "./prebuilt-bundle-runtime.candidate-promotion.js";

function operation(cartLineId) {
  return {
    expand: {
      cartLineId,
      title: "Master Kit Test",
      expandedCartItems: [{
        merchandiseId: "gid://shopify/ProductVariant/component",
        quantity: 1,
        price: { adjustment: { fixedPricePerUnit: { amount: "100.00" } } },
      }],
    },
  };
}

function hardcoded() {
  return { operations: [operation("gid://shopify/CartLine/builder")] };
}

function candidate(overrides = {}) {
  return {
    status: "ready",
    metadata_observations: [{ observation: { status: "valid" } }],
    prepared_candidates: [{ cart_line_id: "gid://shopify/CartLine/prebuilt" }],
    operation_shape_issues: [],
    result: { operations: [operation("gid://shopify/CartLine/prebuilt")] },
    ...overrides,
  };
}

describe("pre-built Bundle candidate promotion", () => {
  it("merges a complete candidate without mutating or reusing Shared Core output", () => {
    const sharedCore = hardcoded();
    const candidateResult = candidate();
    const before = structuredClone(sharedCore);
    const promoted = promotePrebuiltBundleRuntimeCandidate(sharedCore, candidateResult);

    expect(promoted.operations).toHaveLength(2);
    expect(promoted.operations[0]).not.toBe(sharedCore.operations[0]);
    expect(promoted.operations[1]).not.toBe(candidateResult.result.operations[0]);
    expect(sharedCore).toEqual(before);
    expect(Object.isFrozen(promoted)).toBe(true);
  });

  it("reuses builder-owned deeply frozen candidate operations without a second clone traversal", () => {
    const sharedCore = hardcoded();
    const candidateResult = deepFreeze(candidate());
    const candidateOperation = candidateResult.result.operations[0];

    const promoted = promotePrebuiltBundleRuntimeCandidate(sharedCore, candidateResult);

    expect(promoted.operations[0]).not.toBe(sharedCore.operations[0]);
    expect(promoted.operations[1]).toBe(candidateOperation);
    expect(Object.isFrozen(promoted)).toBe(true);
    expect(Object.isFrozen(promoted.operations)).toBe(true);
  });

  it("identifies only fully gated candidate Cart lines for Shared Core exclusion", () => {
    expect(isPrebuiltBundleRuntimeCandidateComplete(candidate())).toBe(true);
    expect([...getPrebuiltCandidateCartLineIds(candidate())]).toEqual([
      "gid://shopify/CartLine/prebuilt",
    ]);
    expect(getPrebuiltCandidateCartLineIds(candidate({ status: "invalid" }))).toEqual(new Set());
  });

  it.each([
    ["candidate is not ready", candidate({ status: "invalid" })],
    ["metadata is invalid", candidate({ metadata_observations: [{ observation: { status: "invalid" } }] })],
    ["prepared candidate is missing", candidate({ prepared_candidates: [] })],
    ["operation count is incomplete", candidate({ result: { operations: [] } })],
    ["unknown operation field exists", candidate({ result: { operations: [{ ...operation("gid://shopify/CartLine/prebuilt"), unexpected: true }] } })],
    ["operation conflicts with Shared Core", candidate({ result: { operations: [operation("gid://shopify/CartLine/builder")] } })],
  ])("falls back to a fresh Shared Core clone when %s", (_reason, invalidCandidate) => {
    const sharedCore = hardcoded();
    const fallback = promotePrebuiltBundleRuntimeCandidate(sharedCore, invalidCandidate);

    expect(fallback).toEqual(sharedCore);
    expect(fallback).not.toBe(sharedCore);
    expect(fallback.operations).not.toBe(sharedCore.operations);
  });
});

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
