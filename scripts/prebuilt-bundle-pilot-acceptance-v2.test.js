import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  calculatePrebuiltBundleExpandProjectionV2Checksum,
  compilePrebuiltBundleExpandProjectionV2,
} from "../extensions/master-kit-expand/src/config/prebuilt-bundle-expand-projection-v2.js";
import { buildPrebuiltProjectionPublicationEvidenceV2 } from "../extensions/master-kit-expand/src/config/prebuilt-projection-publication-evidence-v2.js";
import {
  PREBUILT_BUNDLE_PILOT_ACCEPTANCE_V2_SCHEMA_VERSION,
  assessPrebuiltBundlePilotAcceptanceV2,
} from "./prebuilt-bundle-pilot-acceptance-v2.js";

const parent = "gid://shopify/ProductVariant/400";
const instanceA = "77770000-0000-4000-8000-000000000011";
const instanceB = "77770000-0000-4000-8000-000000000012";

function projectionComponent(sequence, overrides = {}) {
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

function trustedArtifacts({
  components = [projectionComponent(1), projectionComponent(2)],
  parentPrice = "10.50",
} = {}) {
  const compiled = compilePrebuiltBundleExpandProjectionV2({
    mapping: {
      bundle_definition_id: "77770000-0000-4000-8000-000000000001",
      published_revision_id: "77770000-0000-4000-8000-000000000002",
      snapshot_checksum: "snapshot-v2-checksum",
    },
    resolved_candidate: {
      parent: {
        product_gid: "gid://shopify/Product/300",
        variant_gid: parent,
        sku: "BUNDLE-100",
        title: "Bundle 100",
      },
      components,
    },
    parent_fixed_price_per_unit: parentPrice,
  });
  expect(compiled.status).toBe("ready");
  const publication = buildPrebuiltProjectionPublicationEvidenceV2({
    projection: compiled.projection,
  });
  return {
    projection: compiled.projection,
    publication_evidence: publication.evidence,
  };
}

function expandedComponents(instanceIds, components) {
  return instanceIds.flatMap((bundleInstanceId) => components.map((component) => ({
    bundle_instance_id: bundleInstanceId,
    variant_gid: component.variant_gid,
    quantity: component.quantity,
    fixed_price_per_unit_minor_units: component.fixed_price_per_unit_minor_units,
  })));
}

function evidence(options = {}) {
  const artifacts = trustedArtifacts(options);
  const instanceIds = options.instanceIds ?? [instanceA, instanceB];
  const projected = artifacts.publication_evidence.components.map((component) => ({
    variant_gid: component.variant_gid,
    quantity: component.quantity,
    fixed_price_per_unit_minor_units: component.fixed_price_per_unit_minor_units,
  }));
  const aggregate = projected.map((component) => ({
    variant_gid: component.variant_gid,
    delta: -(component.quantity * instanceIds.length),
  }));
  const totalMinorUnits = artifacts.publication_evidence.parent_total_minor_units
    * instanceIds.length;
  return {
    schema_version: "prebuilt_bundle_pilot_acceptance.v2",
    projection: artifacts.projection,
    publication_evidence: artifacts.publication_evidence,
    pilot_scope: {
      store_domain: "huang-mvqquz1p.myshopify.com",
      product_series_key: "efi",
      projection_schema_version: artifacts.projection.schema_version,
      projection_contract_identity: artifacts.projection.contract_identity,
      projection_checksum: artifacts.projection.checksum,
      parent_variant_gid: parent,
      parent_total_minor_units: artifacts.publication_evidence.parent_total_minor_units,
      expected_components: projected,
      bundle_instance_ids: instanceIds,
    },
    evidence: {
      cart: {
        instances: instanceIds.map((bundleInstanceId) => ({
          bundle_instance_id: bundleInstanceId,
          parent_variant_gid: parent,
          parent_line_count: 1,
          parent_quantity: 1,
          component_line_count: 0,
          bundle_metadata_v1_present: true,
        })),
      },
      checkout: {
        projection_checksum: artifacts.projection.checksum,
        components: expandedComponents(instanceIds, projected),
        total_minor_units: totalMinorUnits,
      },
      order: {
        projection_checksum: artifacts.projection.checksum,
        components: expandedComponents(instanceIds, projected),
        total_minor_units: totalMinorUnits,
      },
      inventory: {
        parent_variant_gid: parent,
        parent_delta: 0,
        component_deltas: aggregate,
      },
    },
  };
}

describe("pre-built Bundle pilot acceptance V2", () => {
  it("passes only evidence bound to a checksum-valid Projection and exact publication evidence", () => {
    const result = assessPrebuiltBundlePilotAcceptanceV2(evidence());

    expect(result).toMatchObject({
      schema_version: PREBUILT_BUNDLE_PILOT_ACCEPTANCE_V2_SCHEMA_VERSION,
      status: "passed",
      accepted: true,
      summary: { failed: 0, invalid: 0 },
      writes_performed: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects missing, altered, or self-reported-only Projection/publication bindings", () => {
    const missingProjection = evidence();
    delete missingProjection.projection;
    const missingPublication = evidence();
    delete missingPublication.publication_evidence;
    const alteredPublication = evidence();
    alteredPublication.publication_evidence = {
      ...alteredPublication.publication_evidence,
      projection_checksum: "self-reported-checksum",
    };
    const alteredScopeChecksum = evidence();
    alteredScopeChecksum.pilot_scope.projection_checksum = "self-reported-checksum";

    for (const input of [
      missingProjection,
      missingPublication,
      alteredPublication,
      alteredScopeChecksum,
    ]) {
      const result = assessPrebuiltBundlePilotAcceptanceV2(input);
      expect(result).toMatchObject({ status: "invalid", accepted: false });
      expect(result.issues.map((item) => item.code)).toContain("INVALID_PROJECTION_BINDING");
    }
  });

  it("rejects acceptance evidence when a component Variant equals the parent Variant", () => {
    const input = evidence();
    input.projection = structuredClone(input.projection);
    input.publication_evidence = structuredClone(input.publication_evidence);
    input.projection.components[0].variant_gid = parent;
    input.projection.checksum =
      calculatePrebuiltBundleExpandProjectionV2Checksum(input.projection);
    input.publication_evidence.components[0].variant_gid = parent;
    input.publication_evidence.projection_checksum = input.projection.checksum;
    input.pilot_scope.expected_components[0].variant_gid = parent;
    input.pilot_scope.projection_checksum = input.projection.checksum;
    input.evidence.checkout.projection_checksum = input.projection.checksum;
    input.evidence.order.projection_checksum = input.projection.checksum;

    const result = assessPrebuiltBundlePilotAcceptanceV2(input);
    expect(result).toMatchObject({ status: "invalid", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain("INVALID_PROJECTION_BINDING");
  });

  it("rejects prototypes, class instances, unknown own keys, and custom array properties at every acceptance layer", () => {
    const cases = [
      (input) => { input.unexpected = true; },
      (input) => { input.pilot_scope.unexpected = true; },
      (input) => { input.evidence.unexpected = true; },
      (input) => { input.evidence.cart.unexpected = true; },
      (input) => { input.evidence.cart.instances[0].unexpected = true; },
      (input) => { input.evidence.checkout.unexpected = true; },
      (input) => { input.evidence.checkout.components[0].unexpected = true; },
      (input) => { input.evidence.inventory.unexpected = true; },
      (input) => { input.evidence.inventory.component_deltas[0].unexpected = true; },
      (input) => { input.evidence.checkout.components.unexpected = true; },
      (input) => {
        Object.defineProperty(input.evidence.inventory, "hidden", { value: true });
      },
      (input) => {
        class PilotScope {
          constructor(value) { Object.assign(this, value); }
        }
        input.pilot_scope = new PilotScope(input.pilot_scope);
      },
      (input) => {
        input.evidence.cart = Object.assign(
          Object.create({ instances: input.evidence.cart.instances }),
          input.evidence.cart,
        );
      },
    ];

    for (const mutate of cases) {
      const input = evidence();
      mutate(input);
      const result = assessPrebuiltBundlePilotAcceptanceV2(input);
      expect(result).toMatchObject({ status: "invalid", accepted: false });
      expect(result.issues.map((item) => item.code)).toContain("INVALID_DOCUMENT_SHAPE");
    }
  });

  it("limits projected per-instance quantity to i32::MAX", () => {
    const input = evidence();
    input.pilot_scope.expected_components[0].quantity = 2_147_483_648;

    const result = assessPrebuiltBundlePilotAcceptanceV2(input);
    expect(result).toMatchObject({ status: "invalid", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain("INVALID_PROJECTED_QUANTITY");
  });

  it("allows safe-integer observed aggregates above i32::MAX", () => {
    const input = evidence({
      components: [
        projectionComponent(1, {
          quantity: 2_147_483_647,
          fixedPricePerUnit: "0.00",
        }),
      ],
      parentPrice: "0.00",
    });

    expect(input.evidence.inventory.component_deltas[0].delta).toBe(-4_294_967_294);
    expect(assessPrebuiltBundlePilotAcceptanceV2(input)).toMatchObject({
      status: "passed",
      accepted: true,
    });
  });

  it("requires UUID bundle instance IDs", () => {
    const input = evidence();
    input.pilot_scope.bundle_instance_ids[0] = "bundle-instance-1";

    const result = assessPrebuiltBundlePilotAcceptanceV2(input);
    expect(result).toMatchObject({ status: "invalid", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain("INVALID_BUNDLE_INSTANCES");
  });

  it("fails when any Cart bundle instance is not exactly one quantity-one parent", () => {
    const input = evidence();
    input.evidence.cart.instances[1].parent_quantity = 2;

    const result = assessPrebuiltBundlePilotAcceptanceV2(input);
    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain("CART_INSTANCE_PARENT_MISMATCH");
  });

  it.each(["checkout", "order"])(
    "requires %s components to match the Projection independently for every bundle instance",
    (stage) => {
      const aggregated = evidence();
      aggregated.evidence[stage].components = aggregated.pilot_scope.expected_components.map(
        (component) => ({
          bundle_instance_id: instanceA,
          variant_gid: component.variant_gid,
          quantity: component.quantity * 2,
          fixed_price_per_unit_minor_units: component.fixed_price_per_unit_minor_units,
        }),
      );
      const missingInstanceComponent = evidence();
      missingInstanceComponent.evidence[stage].components.pop();

      for (const input of [aggregated, missingInstanceComponent]) {
        const result = assessPrebuiltBundlePilotAcceptanceV2(input);
        expect(result).toMatchObject({ status: "failed", accepted: false });
        expect(result.issues.map((item) => item.code))
          .toContain(`${stage.toUpperCase()}_COMPONENT_MISMATCH`);
      }
    },
  );

  it.each([
    ["checkout quantity", (input) => {
      input.evidence.checkout.components[0].quantity = 1;
    }, "CHECKOUT_COMPONENT_MISMATCH"],
    ["order per-unit price", (input) => {
      input.evidence.order.components[0].fixed_price_per_unit_minor_units = 124;
    }, "ORDER_COMPONENT_MISMATCH"],
    ["checkout total", (input) => {
      input.evidence.checkout.total_minor_units = 2099;
    }, "CHECKOUT_TOTAL_MISMATCH"],
    ["order projection checksum", (input) => {
      input.evidence.order.projection_checksum = "other";
    }, "ORDER_PROJECTION_MISMATCH"],
    ["parent inventory delta", (input) => {
      input.evidence.inventory.parent_delta = -2;
    }, "PARENT_INVENTORY_CHANGED"],
    ["component inventory delta", (input) => {
      input.evidence.inventory.component_deltas[1].delta = -7;
    }, "COMPONENT_INVENTORY_MISMATCH"],
  ])("fails closed for inconsistent %s evidence", (_label, mutate, issueCode) => {
    const input = evidence();
    mutate(input);

    const result = assessPrebuiltBundlePilotAcceptanceV2(input);
    expect(result).toMatchObject({ status: "failed", accepted: false });
    expect(result.issues.map((item) => item.code)).toContain(issueCode);
  });

  it.each(["cart", "checkout", "order", "inventory"])(
    "fails closed when %s evidence is missing",
    (field) => {
      const input = evidence();
      delete input.evidence[field];

      const result = assessPrebuiltBundlePilotAcceptanceV2(input);
      expect(result).toMatchObject({ status: "invalid", accepted: false });
      expect(result.issues.map((item) => item.code)).toContain("INVALID_DOCUMENT_SHAPE");
    },
  );

  it("publishes a recursively closed V2 Schema aligned with runtime uniqueness semantics", async () => {
    const schema = JSON.parse(await readFile(
      new URL("../docs/schemas/prebuilt-bundle-pilot-acceptance.v2.schema.json", import.meta.url),
      "utf8",
    ));

    expect(schema.required).toEqual([
      "schema_version",
      "projection",
      "publication_evidence",
      "pilot_scope",
      "evidence",
    ]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.pilot_scope.additionalProperties).toBe(false);
    expect(schema.properties.evidence.additionalProperties).toBe(false);
    expect(schema.properties.pilot_scope.properties.bundle_instance_ids.items)
      .toEqual({ "$ref": "#/$defs/uuid" });
    expect(schema.properties.pilot_scope.properties.bundle_instance_ids.uniqueItems).toBe(true);
    expect(schema.$defs.projectedComponent.properties.quantity)
      .toEqual({ "$ref": "#/$defs/positiveI32" });
    expect(schema.$defs.positiveI32.maximum).toBe(2_147_483_647);
    expect(schema.$defs.expandedComponent.required[0]).toBe("bundle_instance_id");
    expect(schema.$defs.expandedEvidence.properties.components.uniqueItems).toBe(true);
    expect(schema.$defs.expandedEvidence.properties.components.description)
      .toContain("bundle_instance_id + variant_gid");
  });
});
