import { describe, expect, it } from "vitest";

import {
  PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_CONTRACT_IDENTITY,
  calculatePrebuiltBundleExpandProjectionV2Checksum,
  compilePrebuiltBundleExpandProjectionV2,
  isValidPrebuiltBundleExpandProjectionV2,
  validatePrebuiltBundleExpandProjectionV2,
} from "./prebuilt-bundle-expand-projection-v2.js";
import { MAX_PREBUILT_COMPONENT_QUANTITY_V2 } from "./prebuilt-bundle-import.quantity-v2.js";

const MAPPING = Object.freeze({
  bundle_definition_id: "77770000-0000-4000-8000-000000000001",
  published_revision_id: "77770000-0000-4000-8000-000000000002",
  snapshot_checksum: "snapshot-v2-checksum",
});

function component(sequence, overrides = {}) {
  return {
    sequence,
    componentGroup: `group-${sequence}`,
    componentRole: `role-${sequence}`,
    productId: `gid://shopify/Product/${100 + sequence}`,
    variantId: `gid://shopify/ProductVariant/${200 + sequence}`,
    sku: `PART-${sequence}`,
    title: `Part ${sequence}`,
    quantity: sequence === 1 ? 2 : sequence === 2 ? 4 : 8,
    fixedPricePerUnit: sequence === 1 ? "1.25" : sequence === 2 ? "2.00" : "0.50",
    sourceIdentity: `bundles-app:bundle-100:component-${sequence}`,
    auditProvenance: {
      sourceSystem: "bundles-app",
      sourceBundleId: "bundle-100",
      sourceRecordChecksum: "record-checksum-100",
    },
    ...overrides,
  };
}

function fixture(overrides = {}) {
  return {
    mapping: MAPPING,
    resolved_candidate: {
      parent: {
        product_gid: "gid://shopify/Product/100",
        variant_gid: "gid://shopify/ProductVariant/200",
        sku: "BUNDLE-100",
        title: "Bundle 100",
      },
      components: [component(1), component(2), component(3)],
    },
    parent_fixed_price_per_unit: "14.50",
    ...overrides,
  };
}

describe("pre-built publication-time expand projection V2", () => {
  it("compiles x2, x4, and x8 components with quantity and per-unit price", () => {
    const result = compilePrebuiltBundleExpandProjectionV2(fixture());

    expect(result.status).toBe("ready");
    expect(result.projection).toMatchObject({
      schema_version: "prebuilt_bundle_expand_projection.v2",
      contract_identity: PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_CONTRACT_IDENTITY,
      parent: {
        variant_gid: "gid://shopify/ProductVariant/200",
        fixed_price_per_unit: "14.50",
      },
      components: [
        {
          variant_gid: "gid://shopify/ProductVariant/201",
          quantity: 2,
          fixed_price_per_unit: "1.25",
          source_identity: "bundles-app:bundle-100:component-1",
          audit_provenance: {
            source_system: "bundles-app",
            source_bundle_id: "bundle-100",
            source_record_checksum: "record-checksum-100",
          },
        },
        {
          variant_gid: "gid://shopify/ProductVariant/202",
          quantity: 4,
          fixed_price_per_unit: "2.00",
          source_identity: "bundles-app:bundle-100:component-2",
        },
        {
          variant_gid: "gid://shopify/ProductVariant/203",
          quantity: 8,
          fixed_price_per_unit: "0.50",
          source_identity: "bundles-app:bundle-100:component-3",
        },
      ],
    });
    expect(validatePrebuiltBundleExpandProjectionV2(result.projection)).toEqual([]);
    expect(isValidPrebuiltBundleExpandProjectionV2(result.projection)).toBe(true);
    expect(Object.isFrozen(result.projection)).toBe(true);
    expect(Object.isFrozen(result.projection.components[0].audit_provenance)).toBe(true);
  });

  it("fails closed when a Variant appears more than once", () => {
    const duplicated = fixture();
    duplicated.resolved_candidate.components[1].variantId = duplicated.resolved_candidate.components[0].variantId;

    expect(compilePrebuiltBundleExpandProjectionV2(duplicated)).toMatchObject({
      status: "unavailable",
      reason: "PROJECTION_INVALID",
      errors: [expect.stringContaining("duplicate variant_gid")],
    });
  });

  it.each([0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid projected quantity %s",
    (quantity) => {
      const invalid = fixture();
      invalid.resolved_candidate.components[0].quantity = quantity;

      expect(compilePrebuiltBundleExpandProjectionV2(invalid)).toMatchObject({
        status: "unavailable",
        reason: "PROJECTION_INVALID",
        errors: [expect.stringContaining("quantity")],
      });
    },
  );

  it("accepts i32::MAX and rejects i32::MAX + 1", () => {
    const atLimit = fixture({
      resolved_candidate: {
        ...fixture().resolved_candidate,
        components: [
          component(1, {
            quantity: MAX_PREBUILT_COMPONENT_QUANTITY_V2,
            fixedPricePerUnit: "0.00",
          }),
        ],
      },
      parent_fixed_price_per_unit: "0.00",
    });
    expect(compilePrebuiltBundleExpandProjectionV2(atLimit).status).toBe("ready");

    atLimit.resolved_candidate.components[0].quantity = MAX_PREBUILT_COMPONENT_QUANTITY_V2 + 1;
    expect(compilePrebuiltBundleExpandProjectionV2(atLimit)).toMatchObject({
      status: "unavailable",
      reason: "PROJECTION_INVALID",
      errors: [expect.stringContaining("quantity")],
    });
  });

  it("rejects checked multiplication and summation overflow", () => {
    const multiplicationOverflow = fixture({
      resolved_candidate: {
        ...fixture().resolved_candidate,
        components: [
          component(1, {
            quantity: MAX_PREBUILT_COMPONENT_QUANTITY_V2,
            fixedPricePerUnit: "45000000.00",
          }),
        ],
      },
      parent_fixed_price_per_unit: "0.00",
    });
    expect(compilePrebuiltBundleExpandProjectionV2(multiplicationOverflow)).toMatchObject({
      status: "unavailable",
      reason: "PROJECTION_INVALID",
      errors: [expect.stringContaining("overflow")],
    });

    const summationOverflow = fixture({
      resolved_candidate: {
        ...fixture().resolved_candidate,
        components: [
          component(1, { quantity: 1, fixedPricePerUnit: "45035996273705.00" }),
          component(2, { quantity: 1, fixedPricePerUnit: "45035996273705.00" }),
        ],
      },
      parent_fixed_price_per_unit: "0.00",
    });
    expect(compilePrebuiltBundleExpandProjectionV2(summationOverflow)).toMatchObject({
      status: "unavailable",
      reason: "PROJECTION_INVALID",
      errors: [expect.stringContaining("overflow")],
    });
  });

  it("rejects unsupported component and parent price precision", () => {
    const componentPrecision = fixture();
    componentPrecision.resolved_candidate.components[0].fixedPricePerUnit = "1.234";
    expect(compilePrebuiltBundleExpandProjectionV2(componentPrecision)).toMatchObject({
      status: "unavailable",
      reason: "PROJECTION_INVALID",
      errors: [expect.stringContaining("fixed_price_per_unit")],
    });

    expect(compilePrebuiltBundleExpandProjectionV2({
      ...fixture(),
      parent_fixed_price_per_unit: "14.5",
    })).toMatchObject({
      status: "unavailable",
      reason: "PROJECTION_INVALID",
      errors: [expect.stringContaining("parent.fixed_price_per_unit")],
    });
  });

  it("rejects non-canonical decimal spellings with leading zeroes", () => {
    const componentLeadingZero = fixture();
    componentLeadingZero.resolved_candidate.components[0].fixedPricePerUnit = "01.25";
    expect(compilePrebuiltBundleExpandProjectionV2(componentLeadingZero)).toMatchObject({
      status: "unavailable",
      reason: "PROJECTION_INVALID",
      errors: [expect.stringContaining("fixed_price_per_unit")],
    });

    expect(compilePrebuiltBundleExpandProjectionV2({
      ...fixture(),
      parent_fixed_price_per_unit: "014.50",
    })).toMatchObject({
      status: "unavailable",
      reason: "PROJECTION_INVALID",
      errors: [expect.stringContaining("parent.fixed_price_per_unit")],
    });
  });

  it("rejects a component total that does not equal the parent price", () => {
    expect(compilePrebuiltBundleExpandProjectionV2({
      ...fixture(),
      parent_fixed_price_per_unit: "14.51",
    })).toMatchObject({
      status: "unavailable",
      reason: "PROJECTION_INVALID",
      errors: ["component total does not match parent fixed_price_per_unit"],
    });
  });

  it("binds the checksum to the V2 contract identity and quantity", () => {
    const { projection } = compilePrebuiltBundleExpandProjectionV2(fixture());
    const wrongIdentity = {
      ...projection,
      contract_identity: "prebuilt_bundle_expand_projection.v1",
    };
    const changedQuantity = {
      ...projection,
      components: projection.components.map((item, index) => (
        index === 0 ? { ...item, quantity: 1 } : item
      )),
    };

    expect(calculatePrebuiltBundleExpandProjectionV2Checksum(projection)).toBe(projection.checksum);
    expect(calculatePrebuiltBundleExpandProjectionV2Checksum(wrongIdentity)).not.toBe(projection.checksum);
    expect(calculatePrebuiltBundleExpandProjectionV2Checksum(changedQuantity)).not.toBe(projection.checksum);
    expect(validatePrebuiltBundleExpandProjectionV2(wrongIdentity)).toEqual(expect.arrayContaining([
      "projection contract_identity is invalid",
      "projection checksum is invalid",
    ]));
    expect(isValidPrebuiltBundleExpandProjectionV2(changedQuantity)).toBe(false);
  });

  it("preserves audit provenance and binds it into the checksum", () => {
    const { projection } = compilePrebuiltBundleExpandProjectionV2(fixture());
    const changedProvenance = {
      ...projection,
      components: projection.components.map((item, index) => index === 0
        ? {
          ...item,
          audit_provenance: {
            ...item.audit_provenance,
            source_record_checksum: "different-checksum",
          },
        }
        : item),
    };

    expect(calculatePrebuiltBundleExpandProjectionV2Checksum(changedProvenance))
      .not.toBe(projection.checksum);
    expect(validatePrebuiltBundleExpandProjectionV2(changedProvenance))
      .toContain("projection checksum is invalid");
  });

  it("fails closed instead of throwing for malformed component collections", () => {
    const { projection } = compilePrebuiltBundleExpandProjectionV2(fixture());

    expect(() => isValidPrebuiltBundleExpandProjectionV2({
      ...projection,
      components: {},
    })).not.toThrow();
    expect(isValidPrebuiltBundleExpandProjectionV2({
      ...projection,
      components: [null],
    })).toBe(false);
  });

  it("returns unavailable instead of throwing for malformed compiler components", () => {
    for (const components of [{}, null, [null]]) {
      const input = fixture({
        resolved_candidate: {
          ...fixture().resolved_candidate,
          components,
        },
      });

      expect(() => compilePrebuiltBundleExpandProjectionV2(input)).not.toThrow();
      expect(compilePrebuiltBundleExpandProjectionV2(input)).toMatchObject({
        status: "unavailable",
        reason: "PROJECTION_INPUT_INVALID",
        projection: null,
      });
    }
  });

  it("makes the boolean validator total for BigInt and non-finite numeric inputs", () => {
    const { projection } = compilePrebuiltBundleExpandProjectionV2(fixture());
    const malformed = [
      {
        ...projection,
        components: projection.components.map((item, index) => (
          index === 0 ? { ...item, quantity: 1n } : item
        )),
      },
      {
        ...projection,
        components: projection.components.map((item, index) => (
          index === 0 ? { ...item, quantity: Number.NaN } : item
        )),
      },
      {
        ...projection,
        components: projection.components.map((item, index) => (
          index === 0 ? { ...item, quantity: Number.POSITIVE_INFINITY } : item
        )),
      },
      {
        ...projection,
        components: projection.components.map((item, index) => (
          index === 0
            ? {
              ...item,
              audit_provenance: {
                ...item.audit_provenance,
                source_record_checksum: 1n,
              },
            }
            : item
        )),
      },
    ];

    for (const candidate of malformed) {
      expect(() => isValidPrebuiltBundleExpandProjectionV2(candidate)).not.toThrow();
      expect(isValidPrebuiltBundleExpandProjectionV2(candidate)).toBe(false);
    }
  });

  it("returns stable unavailable output for non-JSON-safe compiler fields", () => {
    const circularChecksum = {};
    circularChecksum.self = circularChecksum;
    const inputs = [
      fixture({
        resolved_candidate: {
          ...fixture().resolved_candidate,
          components: [
            component(1, { quantity: 1n }),
          ],
        },
      }),
      fixture({
        resolved_candidate: {
          ...fixture().resolved_candidate,
          components: [
            component(1, {
              auditProvenance: {
                sourceSystem: "bundles-app",
                sourceBundleId: "bundle-100",
                sourceRecordChecksum: circularChecksum,
              },
            }),
          ],
        },
      }),
    ];

    for (const input of inputs) {
      expect(() => compilePrebuiltBundleExpandProjectionV2(input)).not.toThrow();
      expect(compilePrebuiltBundleExpandProjectionV2(input)).toEqual({
        status: "unavailable",
        reason: "PROJECTION_INVALID",
        errors: ["projection contains non-JSON-safe values"],
        projection: null,
      });
    }
  });
});
