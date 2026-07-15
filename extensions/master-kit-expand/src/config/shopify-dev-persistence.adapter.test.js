import { describe, expect, it } from "vitest";
import { BundlePersistenceError } from "./bundle-persistence.adapter.js";
import {
  DEV_SHOPIFY_APP_CLIENT_ID,
  createDevShopifyPersistenceAdapter,
} from "./shopify-dev-persistence.adapter.js";

const definition = {
  bundle_definition_id: "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89",
  active_revision_id: "0a9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef701",
  parent_binding: { product_gid: "gid://shopify/Product/10600519598358" },
};
const previousSnapshot = { checksum: "1234abcd" };
const targetSnapshot = { checksum: "5678abcd" };

function createAdapter({ snapshot = previousSnapshot, activeRevisionId = definition.active_revision_id, userErrors = [] } = {}) {
  const calls = [];
  const execute = async (query, { variables }) => {
    calls.push({ query, variables });
    if (query.includes("BundlePersistenceMetaobjects")) {
      return { data: { metaobjects: { nodes: [{ fields: [{ key: "document", jsonValue: definition }] }] } } };
    }
    if (query.includes("BundlePersistenceMetaobject")) {
      return { data: { metaobjectByHandle: { id: "gid://shopify/Metaobject/1", fields: [{ key: "document", jsonValue: definition }] } } };
    }
    if (query.includes("BundlePersistenceProductMetafield")) {
      const isSnapshot = variables.key === "bundle_runtime_snapshot_v1";
      const value = isSnapshot ? snapshot : activeRevisionId;
      return { data: { product: { metafield: value === null ? null : {
        type: isSnapshot ? "json" : "single_line_text_field",
        jsonValue: isSnapshot ? value : null,
        value: isSnapshot ? JSON.stringify(value) : value,
        compareDigest: "digest-1",
      } } } };
    }
    if (query.includes("BundlePersistenceMetafieldsSet")) {
      const field = variables.metafields[0];
      return { data: { metafieldsSet: { metafields: [{
        type: field.type,
        value: field.value,
        jsonValue: field.type === "json" ? JSON.parse(field.value) : null,
        compareDigest: "digest-2",
      }], userErrors } } };
    }
    throw new Error("unexpected Shopify operation");
  };
  return { adapter: createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID }), calls };
}

describe("development Shopify persistence adapter", () => {
  it("rejects any client other than cart-transform-poc-dev", () => {
    expect(() => createDevShopifyPersistenceAdapter({ execute: async () => ({}), appClientId: "529f335a66e6b1b2924ba30c1b8630b4" }))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_CAPABILITY" }));
  });

  it("reads definition documents through the dev-only Metaobject type", async () => {
    const { adapter, calls } = createAdapter();
    await expect(adapter.readBundleDefinition(definition.bundle_definition_id)).resolves.toEqual(definition);
    expect(calls[0].variables.type).toBe("$app:aces_bundle_definition_dev");
  });

  it("lists definitions and filters revision history through dev-only Metaobject types", async () => {
    const { adapter, calls } = createAdapter();
    const listed = await adapter.listBundleDefinitions();
    const revisions = await adapter.listRevisionsByDefinition(definition.bundle_definition_id);

    expect(listed).toEqual([definition]);
    expect(revisions).toEqual([definition]);
    expect(calls.filter((call) => call.query.includes("BundlePersistenceMetaobjects")))
      .toHaveLength(2);
  });

  it("uses the canonical app-owned PublicationRecord type", async () => {
    const { adapter, calls } = createAdapter();
    await expect(adapter.readPublicationById("2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703")).resolves.toEqual(definition);
    expect(calls[0].variables.type).toBe("$app:aces_bundle_publication_record_dev");
  });

  it("writes Snapshot values with the read compareDigest only after checksum parity", async () => {
    const { adapter, calls } = createAdapter();
    await expect(adapter.writeRuntimeSnapshot({
      bundle_definition_id: definition.bundle_definition_id,
      expected_previous_snapshot_checksum: previousSnapshot.checksum,
      target_revision_id: "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702",
      target_snapshot_checksum: targetSnapshot.checksum,
      publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
      snapshot: targetSnapshot,
    })).resolves.toEqual(targetSnapshot);
    const write = calls.find((call) => call.query.includes("BundlePersistenceMetafieldsSet"));
    expect(write.variables.metafields[0]).toMatchObject({ namespace: "aces_dev", compareDigest: "digest-1" });
  });

  it("rejects Snapshot writes when the previous checksum has drifted", async () => {
    const { adapter } = createAdapter();
    await expect(adapter.writeRuntimeSnapshot({
      bundle_definition_id: definition.bundle_definition_id,
      expected_previous_snapshot_checksum: "wrong",
      target_revision_id: "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702",
      target_snapshot_checksum: targetSnapshot.checksum,
      publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
      snapshot: targetSnapshot,
    })).rejects.toThrow(expect.objectContaining({ code: "CHECKSUM_MISMATCH" }));
  });

  it("uses product metafield CAS for the active revision pointer", async () => {
    const { adapter, calls } = createAdapter();
    await expect(adapter.compareAndSetActiveRevision({
      bundle_definition_id: definition.bundle_definition_id,
      expected_active_revision_id: definition.active_revision_id,
      target_revision_id: "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702",
      publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
    })).resolves.toMatchObject({ active_revision_id: "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702" });
    const write = calls.find((call) => call.query.includes("BundlePersistenceMetafieldsSet"));
    expect(write.variables.metafields[0]).toMatchObject({ key: "active_revision_id_v1", compareDigest: "digest-1" });
  });

  it("contains Shopify compare-and-set conflicts and never uses unsafe delete compensation", async () => {
    const { adapter } = createAdapter({ userErrors: [{ code: "INVALID_COMPARE_DIGEST", message: "stale" }] });
    await expect(adapter.compareAndSetActiveRevision({
      bundle_definition_id: definition.bundle_definition_id,
      expected_active_revision_id: definition.active_revision_id,
      target_revision_id: "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702",
      publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
    })).rejects.toThrow(expect.objectContaining({ code: "CHECKSUM_MISMATCH" }));
    await expect(adapter.restorePreviousSnapshot({
      bundle_definition_id: definition.bundle_definition_id,
      expected_previous_snapshot_checksum: null,
      target_revision_id: "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702",
      target_snapshot_checksum: targetSnapshot.checksum,
      publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
      previous_snapshot: null,
    })).rejects.toThrow(BundlePersistenceError);
  });
});
