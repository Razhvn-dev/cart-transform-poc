import { describe, expect, it } from "vitest";

import {
  calculatePrebuiltBundleExpandProjectionV2Checksum,
  compilePrebuiltBundleExpandProjectionV2,
} from "./prebuilt-bundle-expand-projection-v2.js";
import {
  PREBUILT_PROJECTION_PUBLICATION_EVIDENCE_V2_CONTRACT_IDENTITY,
  assertPrebuiltProjectionPublicationEvidenceV2,
  buildPrebuiltProjectionPublicationEvidenceV2,
} from "./prebuilt-projection-publication-evidence-v2.js";

function component(sequence, overrides = {}) {
  return {
    sequence,
    componentGroup: `group-${sequence}`,
    componentRole: `role-${sequence}`,
    productId: `gid://shopify/Product/${300 + sequence}`,
    variantId: `gid://shopify/ProductVariant/${400 + sequence}`,
    sku: `PART-${sequence}`,
    title: `Part ${sequence}`,
    quantity: sequence === 1 ? 2 : 4,
    fixedPricePerUnit: sequence === 1 ? "1.25" : "2.00",
    sourceIdentity: `bundles-app:bundle-100:component-${sequence}`,
    auditProvenance: {
      sourceSystem: "bundles-app",
      sourceBundleId: "bundle-100",
      sourceRecordChecksum: "record-checksum-100",
    },
    ...overrides,
  };
}

function projection() {
  const result = compilePrebuiltBundleExpandProjectionV2({
    mapping: {
      bundle_definition_id: "77770000-0000-4000-8000-000000000001",
      published_revision_id: "77770000-0000-4000-8000-000000000002",
      snapshot_checksum: "snapshot-v2-checksum",
    },
    resolved_candidate: {
      parent: {
        product_gid: "gid://shopify/Product/300",
        variant_gid: "gid://shopify/ProductVariant/400",
        sku: "BUNDLE-100",
        title: "Bundle 100",
      },
      components: [component(1), component(2)],
    },
    parent_fixed_price_per_unit: "10.50",
  });
  expect(result.status).toBe("ready");
  return result.projection;
}

describe("pre-built Projection publication evidence V2", () => {
  it("binds contract identity, checksum, unique component quantities, per-unit minor prices, and parent total", () => {
    const value = projection();
    const result = buildPrebuiltProjectionPublicationEvidenceV2({ projection: value });

    expect(result.evidence).toMatchObject({
      schema_version: "prebuilt_projection_publication_evidence.v2",
      contract_identity: PREBUILT_PROJECTION_PUBLICATION_EVIDENCE_V2_CONTRACT_IDENTITY,
      projection_schema_version: "prebuilt_bundle_expand_projection.v2",
      projection_contract_identity: "prebuilt_bundle_expand_projection.v2",
      projection_checksum: value.checksum,
      parent_variant_gid: "gid://shopify/ProductVariant/400",
      parent_total_minor_units: 1050,
      components: [
        {
          sequence: 1,
          variant_gid: "gid://shopify/ProductVariant/401",
          quantity: 2,
          fixed_price_per_unit_minor_units: 125,
        },
        {
          sequence: 2,
          variant_gid: "gid://shopify/ProductVariant/402",
          quantity: 4,
          fixed_price_per_unit_minor_units: 200,
        },
      ],
    });
    expect(assertPrebuiltProjectionPublicationEvidenceV2(result.evidence, { projection: value })).toBe(true);
    expect(Object.isFrozen(result.evidence.components[0])).toBe(true);
  });

  it.each([
    ["schema_version", "prebuilt_projection_publication_evidence.v1"],
    ["contract_identity", "prebuilt_projection_publication_evidence.v1"],
    ["projection_schema_version", "prebuilt_bundle_expand_projection.v1"],
    ["projection_contract_identity", "prebuilt_bundle_expand_projection.v1"],
    ["projection_checksum", "tampered"],
  ])("rejects altered %s", (field, value) => {
    const source = projection();
    const { evidence } = buildPrebuiltProjectionPublicationEvidenceV2({ projection: source });

    expect(() => assertPrebuiltProjectionPublicationEvidenceV2(
      { ...evidence, [field]: value },
      { projection: source },
    )).toThrow(field);
  });

  it("rejects altered quantity, per-unit minor price, and parent total evidence", () => {
    const source = projection();
    const { evidence } = buildPrebuiltProjectionPublicationEvidenceV2({ projection: source });

    expect(() => assertPrebuiltProjectionPublicationEvidenceV2({
      ...evidence,
      components: evidence.components.map((item, index) => index === 0
        ? { ...item, quantity: 1 }
        : item),
    }, { projection: source })).toThrow("components");
    expect(() => assertPrebuiltProjectionPublicationEvidenceV2({
      ...evidence,
      components: evidence.components.map((item, index) => index === 0
        ? { ...item, fixed_price_per_unit_minor_units: 1 }
        : item),
    }, { projection: source })).toThrow("components");
    expect(() => assertPrebuiltProjectionPublicationEvidenceV2({
      ...evidence,
      parent_total_minor_units: 1049,
    }, { projection: source })).toThrow("parent_total_minor_units");
  });

  it.each([
    ["duplicate Variant", (value) => {
      value.components[1].variant_gid = value.components[0].variant_gid;
    }],
    ["non-positive quantity", (value) => {
      value.components[0].quantity = 0;
    }],
    ["invalid per-unit price", (value) => {
      value.components[0].fixed_price_per_unit = "1.234";
    }],
    ["parent/component total mismatch", (value) => {
      value.parent.fixed_price_per_unit = "10.51";
    }],
  ])("fails closed for a projection with %s", (_label, mutate) => {
    const invalid = structuredClone(projection());
    mutate(invalid);
    invalid.checksum = calculatePrebuiltBundleExpandProjectionV2Checksum(invalid);

    expect(() => buildPrebuiltProjectionPublicationEvidenceV2({ projection: invalid }))
      .toThrow("Projection V2 is invalid");
  });

  it("rejects class instances, inherited properties, unknown own keys, and toJSON on evidence", () => {
    const source = projection();
    const { evidence } = buildPrebuiltProjectionPublicationEvidenceV2({ projection: source });

    class EvidenceRecord {
      constructor(value) {
        Object.assign(this, value);
      }
    }
    const inherited = Object.assign(
      Object.create({ projection_checksum: evidence.projection_checksum }),
      { ...evidence },
    );
    const unknownRoot = { ...evidence, unexpected: true };
    const unknownComponent = {
      ...evidence,
      components: evidence.components.map((item, index) => index === 0
        ? { ...item, unexpected: true }
        : item),
    };
    const componentWithToJSON = {
      ...evidence,
      components: evidence.components.map((item, index) => index === 0
        ? { ...item, toJSON() { return item; } }
        : item),
    };
    const nonEnumerableUnknown = { ...evidence };
    Object.defineProperty(nonEnumerableUnknown, "hidden", { value: true });

    for (const invalid of [
      new EvidenceRecord(evidence),
      inherited,
      unknownRoot,
      unknownComponent,
      componentWithToJSON,
      nonEnumerableUnknown,
    ]) {
      expect(() => assertPrebuiltProjectionPublicationEvidenceV2(
        invalid,
        { projection: source },
      )).toThrow("shape");
    }
  });

  it("rejects non-plain Projection layers and toJSON checksum bypasses before assertion", () => {
    const source = structuredClone(projection());
    source.components[0].toJSON = function toJSON() {
      return {
        ...this,
        quantity: 999,
        toJSON: undefined,
      };
    };

    expect(() => buildPrebuiltProjectionPublicationEvidenceV2({ projection: source }))
      .toThrow("Projection V2 transport shape is invalid");
  });

  it("rejects publication component fields that use toJSON to impersonate primitives", () => {
    const source = projection();
    const { evidence } = buildPrebuiltProjectionPublicationEvidenceV2({ projection: source });

    for (const field of [
      "sequence",
      "variant_gid",
      "quantity",
      "fixed_price_per_unit_minor_units",
    ]) {
      const expected = evidence.components[0][field];
      const spoofed = {
        ...evidence,
        components: evidence.components.map((component, index) => index === 0
          ? {
            ...component,
            [field]: { toJSON() { return expected; } },
          }
          : component),
      };
      expect(() => assertPrebuiltProjectionPublicationEvidenceV2(
        spoofed,
        { projection: source },
      )).toThrow("primitive");
    }
  });

  it("rejects Projection identity fields that impersonate strings through coercion", () => {
    const source = structuredClone(projection());
    const expectedProductGid = source.components[0].product_gid;
    source.components[0].product_gid = {
      toString() { return expectedProductGid; },
      toJSON() { return expectedProductGid; },
    };

    expect(() => buildPrebuiltProjectionPublicationEvidenceV2({ projection: source }))
      .toThrow("primitive");
  });

  it("rejects a component Variant that equals the parent Variant", () => {
    const source = structuredClone(projection());
    source.components[0].variant_gid = source.parent.variant_gid;
    source.checksum = calculatePrebuiltBundleExpandProjectionV2Checksum(source);

    expect(() => buildPrebuiltProjectionPublicationEvidenceV2({ projection: source }))
      .toThrow("parent Variant");
  });
});
