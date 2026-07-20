import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION } from "./prebuilt-bundle-runtime.selection.js";
import { extractPrebuiltBundleRuntimeFunctionInput } from "./prebuilt-bundle-runtime.function-input.js";

function fixture() {
  const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
  return {
    snapshot,
    mapping: {
      schema_version: PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION,
      parent_variant_gid: snapshot.parent.variant_gid,
      bundle_definition_id: snapshot.configuration_id,
      published_revision_id: "77770000-0000-4000-8000-000000000001",
      status: "published",
      pilot_scope_approved: true,
      snapshot_checksum: snapshot.checksum,
      fixed_selections: Object.fromEntries(snapshot.groups.map((group) => [group.key, group.default_option])),
    },
  };
}

function inputLine({ mapping, snapshot, id = "gid://shopify/CartLine/1", mappingField = "jsonValue", snapshotField = "jsonValue" }) {
  const { snapshot: baseline } = fixture();
  return {
    id,
    merchandise: {
      __typename: "ProductVariant",
      id: baseline.parent.variant_gid,
      product: {
        id: baseline.parent.product_gid,
        prebuiltRuntimeMappingMetafield: { [mappingField]: mappingField === "value" ? JSON.stringify(mapping) : mapping },
        prebuiltRuntimeSnapshotMetafield: { [snapshotField]: snapshotField === "value" ? JSON.stringify(snapshot) : snapshot },
      },
    },
  };
}

describe("pre-built Bundle future Function input boundary", () => {
  it("accepts matching server-owned mapping and Snapshot metafields in jsonValue or value form", () => {
    const { mapping, snapshot } = fixture();
    const result = extractPrebuiltBundleRuntimeFunctionInput({
      cart: { lines: [
        inputLine({ mapping, snapshot }),
        inputLine({ mapping, snapshot, id: "gid://shopify/CartLine/2", mappingField: "value", snapshotField: "value" }),
      ] },
    });

    expect(result.entries).toEqual([mapping]);
    expect(result.snapshots_by_definition_id).toEqual({ [mapping.bundle_definition_id]: snapshot });
    expect(result.observations).toEqual([
      { cart_line_id: "gid://shopify/CartLine/1", status: "accepted", reason: null },
      { cart_line_id: "gid://shopify/CartLine/2", status: "accepted", reason: null },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects malformed and non-matching server metafields without creating a candidate input", () => {
    const { mapping, snapshot } = fixture();
    const mismatchedMapping = { ...mapping, parent_variant_gid: "gid://shopify/ProductVariant/999" };
    const result = extractPrebuiltBundleRuntimeFunctionInput({
      cart: { lines: [
        inputLine({ mapping: null, snapshot }),
        inputLine({ mapping: mismatchedMapping, snapshot, id: "gid://shopify/CartLine/2" }),
      ] },
    });

    expect(result.entries).toEqual([]);
    expect(result.snapshots_by_definition_id).toEqual({});
    expect(result.observations.map((observation) => observation.reason)).toEqual([
      "MAPPING_METAFIELD_INVALID",
      "MAPPING_PARENT_VARIANT_MISMATCH",
    ]);
  });

  it("rejects a Snapshot bound to a different parent Product even when the Variant matches", () => {
    const { mapping, snapshot } = fixture();
    const line = inputLine({ mapping, snapshot });
    line.merchandise.product.id = "gid://shopify/Product/999";

    const result = extractPrebuiltBundleRuntimeFunctionInput({ cart: { lines: [line] } });

    expect(result.entries).toEqual([]);
    expect(result.observations[0]).toMatchObject({
      status: "rejected",
      reason: "SNAPSHOT_PARENT_PRODUCT_MISMATCH",
    });
  });

  it("fails closed when the same parent Variant returns conflicting server data", () => {
    const { mapping, snapshot } = fixture();
    const result = extractPrebuiltBundleRuntimeFunctionInput({
      cart: { lines: [
        inputLine({ mapping, snapshot }),
        inputLine({ mapping: { ...mapping, published_revision_id: "77770000-0000-4000-8000-000000000099" }, snapshot, id: "gid://shopify/CartLine/2" }),
      ] },
    });

    expect(result.entries).toEqual([]);
    expect(result.snapshots_by_definition_id).toEqual({});
    expect(result.observations[1]).toMatchObject({ status: "rejected", reason: "CONFLICTING_SERVER_METAFIELDS" });
  });
});
