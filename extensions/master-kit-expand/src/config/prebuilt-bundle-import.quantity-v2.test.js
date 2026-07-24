import { describe, expect, it } from "vitest";

import {
  MAX_PREBUILT_COMPONENT_QUANTITY_V2,
  PREBUILT_BUNDLE_IMPORT_QUANTITY_V2_CONTRACT_IDENTITY,
  normalizePrebuiltBundleImportQuantityV2Components,
} from "./prebuilt-bundle-import.quantity-v2.js";

const VARIANT_A = "gid://shopify/ProductVariant/201";
const VARIANT_B = "gid://shopify/ProductVariant/202";
const VARIANT_C = "gid://shopify/ProductVariant/203";

function component(overrides = {}) {
  return {
    variantId: VARIANT_A,
    quantity: 2,
    fixedPricePerUnit: "12.34",
    sourceIdentity: "bundles-app:bundle-100:component-a",
    auditProvenance: {
      sourceSystem: "bundles-app",
      sourceBundleId: "bundle-100",
      sourceRecordChecksum: "record-checksum-100",
    },
    ...overrides,
  };
}

describe("pre-built Bundle import quantity V2 normalization", () => {
  it("preserves x2, x4, and x8 quantities, per-unit prices, and source identities", () => {
    const result = normalizePrebuiltBundleImportQuantityV2Components([
      component(),
      component({
        variantId: VARIANT_B,
        quantity: 4,
        fixedPricePerUnit: "0.00",
        sourceIdentity: "bundles-app:bundle-100:component-b",
      }),
      component({
        variantId: VARIANT_C,
        quantity: 8,
        fixedPricePerUnit: "99.95",
        sourceIdentity: "bundles-app:bundle-100:component-c",
      }),
    ]);

    expect(result).toEqual([
      {
        variantId: VARIANT_A,
        quantity: 2,
        fixedPricePerUnit: "12.34",
        sourceIdentity: "bundles-app:bundle-100:component-a",
        auditProvenance: {
          sourceSystem: "bundles-app",
          sourceBundleId: "bundle-100",
          sourceRecordChecksum: "record-checksum-100",
        },
      },
      {
        variantId: VARIANT_B,
        quantity: 4,
        fixedPricePerUnit: "0.00",
        sourceIdentity: "bundles-app:bundle-100:component-b",
        auditProvenance: {
          sourceSystem: "bundles-app",
          sourceBundleId: "bundle-100",
          sourceRecordChecksum: "record-checksum-100",
        },
      },
      {
        variantId: VARIANT_C,
        quantity: 8,
        fixedPricePerUnit: "99.95",
        sourceIdentity: "bundles-app:bundle-100:component-c",
        auditProvenance: {
          sourceSystem: "bundles-app",
          sourceBundleId: "bundle-100",
          sourceRecordChecksum: "record-checksum-100",
        },
      },
    ]);
    expect(PREBUILT_BUNDLE_IMPORT_QUANTITY_V2_CONTRACT_IDENTITY)
      .toBe("prebuilt_bundle_import_quantity.v2");
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every(Object.isFrozen)).toBe(true);
    expect(result.every((item) => Object.isFrozen(item.auditProvenance))).toBe(true);
  });

  it("aggregates duplicate Variants with matching price and source identity", () => {
    const result = normalizePrebuiltBundleImportQuantityV2Components([
      component({ quantity: 2 }),
      component({ quantity: 4 }),
    ]);

    expect(result).toEqual([component({ quantity: 6 })]);
  });

  it("keeps A,B,A aggregation in first-seen order and recursively freezes provenance", () => {
    const result = normalizePrebuiltBundleImportQuantityV2Components([
      component({ quantity: 2 }),
      component({
        variantId: VARIANT_B,
        quantity: 4,
        sourceIdentity: "bundles-app:bundle-100:component-b",
      }),
      component({ quantity: 8 }),
    ]);

    expect(result.map(({ variantId, quantity }) => ({ variantId, quantity }))).toEqual([
      { variantId: VARIANT_A, quantity: 10 },
      { variantId: VARIANT_B, quantity: 4 },
    ]);
    expect(Object.isFrozen(result[0].auditProvenance)).toBe(true);
  });

  it("fails closed when duplicate Variants disagree on unit price or source identity", () => {
    expect(() => normalizePrebuiltBundleImportQuantityV2Components([
      component(),
      component({ fixedPricePerUnit: "12.35" }),
    ])).toThrowError(expect.objectContaining({
      name: "PrebuiltBundleImportQuantityV2Error",
      code: "DUPLICATE_VARIANT_PRICE_CONFLICT",
    }));

    expect(() => normalizePrebuiltBundleImportQuantityV2Components([
      component(),
      component({ sourceIdentity: "other-source:bundle-100:component-a" }),
    ])).toThrowError(expect.objectContaining({
      name: "PrebuiltBundleImportQuantityV2Error",
      code: "DUPLICATE_VARIANT_SOURCE_CONFLICT",
    }));
  });

  it("fails closed with a stable error when duplicate provenance conflicts", () => {
    const conflicting = [
      component(),
      component({
        auditProvenance: {
          sourceSystem: "bundles-app",
          sourceBundleId: "bundle-100",
          sourceRecordChecksum: "different-checksum",
        },
      }),
    ];
    const capture = () => {
      try {
        normalizePrebuiltBundleImportQuantityV2Components(conflicting);
        return null;
      } catch (error) {
        return { name: error.name, code: error.code, message: error.message };
      }
    };

    expect(capture()).toEqual({
      name: "PrebuiltBundleImportQuantityV2Error",
      code: "DUPLICATE_VARIANT_PROVENANCE_CONFLICT",
      message: `components[1] conflicts with the existing audit provenance for ${VARIANT_A}`,
    });
    expect(capture()).toEqual(capture());
  });

  it("requires the exact minimal audit provenance contract", () => {
    for (const auditProvenance of [
      null,
      {},
      {
        sourceSystem: "bundles-app",
        sourceBundleId: "bundle-100",
        sourceRecordChecksum: "record-checksum-100",
        unexpected: "field",
      },
    ]) {
      expect(() => normalizePrebuiltBundleImportQuantityV2Components([
        component({ auditProvenance }),
      ])).toThrowError(expect.objectContaining({
        code: "INVALID_AUDIT_PROVENANCE",
      }));
    }
  });

  it.each([
    0,
    -1,
    1.5,
    "2",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid quantity form %s", (quantity) => {
    expect(() => normalizePrebuiltBundleImportQuantityV2Components([
      component({ quantity }),
    ])).toThrowError(expect.objectContaining({
      name: "PrebuiltBundleImportQuantityV2Error",
      code: "INVALID_QUANTITY",
    }));
  });

  it("rejects unsafe aggregate quantities", () => {
    expect(() => normalizePrebuiltBundleImportQuantityV2Components([
      component({ quantity: MAX_PREBUILT_COMPONENT_QUANTITY_V2 }),
      component({ quantity: 1 }),
    ])).toThrowError(expect.objectContaining({
      name: "PrebuiltBundleImportQuantityV2Error",
      code: "QUANTITY_OVERFLOW",
    }));
  });

  it("accepts i32::MAX and rejects i32::MAX + 1", () => {
    expect(normalizePrebuiltBundleImportQuantityV2Components([
      component({ quantity: MAX_PREBUILT_COMPONENT_QUANTITY_V2 }),
    ])[0].quantity).toBe(2_147_483_647);

    expect(() => normalizePrebuiltBundleImportQuantityV2Components([
      component({ quantity: MAX_PREBUILT_COMPONENT_QUANTITY_V2 + 1 }),
    ])).toThrowError(expect.objectContaining({
      code: "INVALID_QUANTITY",
    }));
  });

  it.each([
    12.34,
    "12",
    "12.3",
    "12.345",
    "-1.00",
    "00.10",
    "01.00",
    "90071992547410.00",
  ])("rejects unsupported or unsafe per-unit price %s", (fixedPricePerUnit) => {
    expect(() => normalizePrebuiltBundleImportQuantityV2Components([
      component({ fixedPricePerUnit }),
    ])).toThrowError(expect.objectContaining({
      name: "PrebuiltBundleImportQuantityV2Error",
      code: "INVALID_FIXED_PRICE_PER_UNIT",
    }));
  });

  it("rejects malformed Variant and source identities", () => {
    expect(() => normalizePrebuiltBundleImportQuantityV2Components([
      component({ variantId: "201" }),
    ])).toThrowError(expect.objectContaining({ code: "INVALID_VARIANT_ID" }));

    expect(() => normalizePrebuiltBundleImportQuantityV2Components([
      component({ sourceIdentity: " " }),
    ])).toThrowError(expect.objectContaining({ code: "INVALID_SOURCE_IDENTITY" }));
  });
});
