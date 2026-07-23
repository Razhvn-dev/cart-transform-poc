import { describe, expect, it, vi } from "vitest";
import { BundlePersistenceError } from "./bundle-persistence.adapter.js";
import {
  DEV_SHOPIFY_APP_CLIENT_ID,
  createDevShopifyPersistenceAdapter,
} from "./shopify-dev-persistence.adapter.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { compilePrebuiltBundleExpandProjection } from "./prebuilt-bundle-expand-projection.js";
import { PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION, resolvePrebuiltBundleSelection } from "./prebuilt-bundle-runtime.selection.js";

const definition = {
  bundle_definition_id: "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89",
  active_revision_id: "0a9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef701",
  parent_binding: {
    product_gid: "gid://shopify/Product/10600519598358",
    variant_gid: "gid://shopify/ProductVariant/51505325605142",
  },
};
const previousSnapshot = { checksum: "1234abcd" };
const targetSnapshot = { checksum: "5678abcd" };

function createAdapter({
  snapshot = previousSnapshot,
  projection = null,
  activeRevisionId = definition.active_revision_id,
  userErrors = [],
  bindings,
} = {}) {
  const calls = [];
  const runtimeSnapshotKey = bindings?.metafields?.runtimeSnapshotKey ?? "bundle_runtime_snapshot_v1";
  const projectionKey = bindings?.metafields?.prebuiltExpandProjectionKey ?? "prebuilt_bundle_expand_projection_v1";
  const execute = async (query, { variables }) => {
    calls.push({ query, variables });
    if (query.includes("BundlePersistenceMetaobjects")) {
      return { data: { metaobjects: { nodes: [{ fields: [{ key: "document", jsonValue: definition }] }] } } };
    }
    if (query.includes("BundlePersistenceMetaobject")) {
      return { data: { metaobjectByHandle: { id: "gid://shopify/Metaobject/1", fields: [{ key: "document", jsonValue: definition }] } } };
    }
    if (query.includes("BundlePersistenceProductMetafield")) {
      const isSnapshot = variables.key === runtimeSnapshotKey;
      const isProjection = variables.key === projectionKey;
      const value = isSnapshot ? snapshot : isProjection ? projection : activeRevisionId;
      return { data: { product: { metafield: value === null ? null : {
        type: isSnapshot || isProjection ? "json" : "single_line_text_field",
        jsonValue: isSnapshot || isProjection ? value : null,
        value: isSnapshot || isProjection ? JSON.stringify(value) : value,
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
  return {
    adapter: createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID, bindings }),
    calls,
  };
}

describe("development Shopify persistence adapter", () => {
  function projectionFixture() {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const mapping = {
      schema_version: PREBUILT_BUNDLE_RUNTIME_MAPPING_SCHEMA_VERSION,
      parent_variant_gid: snapshot.parent.variant_gid,
      bundle_definition_id: snapshot.configuration_id,
      published_revision_id: "77770000-0000-4000-8000-000000000001",
      status: "published",
      pilot_scope_approved: true,
      snapshot_checksum: snapshot.checksum,
      fixed_selections: Object.fromEntries(snapshot.groups.map((group) => [group.key, group.default_option])),
    };
    const resolved = resolvePrebuiltBundleSelection({ parent_variant_gid: mapping.parent_variant_gid, mapping, snapshot });
    return compilePrebuiltBundleExpandProjection({ mapping, resolved_candidate: resolved.resolved }).projection;
  }

  it("rejects any client other than cart-transform-poc-dev", () => {
    expect(() => createDevShopifyPersistenceAdapter({ execute: async () => ({}), appClientId: "529f335a66e6b1b2924ba30c1b8630b4" }))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_CAPABILITY" }));
  });

  it("reads definition documents through the dev-only Metaobject type", async () => {
    const { adapter, calls } = createAdapter();
    await expect(adapter.readBundleDefinition(definition.bundle_definition_id)).resolves.toEqual(definition);
    expect(calls[0].variables.type).toBe("$app:aces_bundle_definition_dev");
  });

  it("retries transient Shopify transport failures only for read queries", async () => {
    let attempts = 0;
    const execute = async (query) => {
      expect(query).toContain("BundlePersistenceMetaobjects");
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      return { data: { metaobjects: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } };
    };
    const adapter = createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID });

    await expect(adapter.listBundleDefinitions()).resolves.toEqual([]);
    expect(attempts).toBe(3);
  });

  it("does not automatically retry mutations after a transient transport failure", async () => {
    let mutationAttempts = 0;
    const execute = async (query) => {
      if (query.includes("BundlePersistenceMetaobject($type")) {
        return { data: { metaobjectByHandle: null } };
      }
      if (query.includes("BundlePersistenceMetaobjectCreate")) {
        mutationAttempts += 1;
        throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      }
      throw new Error("unexpected Shopify operation");
    };
    const adapter = createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID });

    await expect(adapter.writeBundleDefinition({ definition })).rejects.toMatchObject({ code: "WRITE_FAILED" });
    expect(mutationAttempts).toBe(1);
  });

  it("returns bounded transient read evidence after retry exhaustion", async () => {
    let attempts = 0;
    const execute = async () => {
      attempts += 1;
      throw Object.assign(new Error("fetch failed"), { code: "UND_ERR_SOCKET" });
    };
    const adapter = createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID });

    await expect(adapter.listBundleDefinitions()).rejects.toMatchObject({
      code: "READ_BACK_FAILED",
      details: { operation: "BundlePersistenceMetaobjects", attempts: 3, transient: true },
    });
    expect(attempts).toBe(3);
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

  it("reads every Metaobject page instead of silently truncating the list at 250 records", async () => {
    const calls = [];
    const execute = async (query, { variables }) => {
      calls.push({ query, variables });
      if (!query.includes("BundlePersistenceMetaobjects")) throw new Error("unexpected Shopify operation");
      if (variables.after === null) {
        return {
          data: {
            metaobjects: {
              nodes: [{ fields: [{ key: "document", jsonValue: definition }] }],
              pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
            },
          },
        };
      }
      return {
        data: {
          metaobjects: {
            nodes: [{ fields: [{ key: "document", jsonValue: { ...definition, bundle_definition_id: "second" } }] }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };
    };
    const adapter = createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID });

    await expect(adapter.listBundleDefinitions()).resolves.toEqual([
      definition,
      { ...definition, bundle_definition_id: "second" },
    ]);
    expect(calls.map((call) => call.variables.after)).toEqual([null, "cursor-1"]);
  });

  it("uses the canonical app-owned PublicationRecord type", async () => {
    const { adapter, calls } = createAdapter();
    await expect(adapter.readPublicationById("2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703")).resolves.toEqual(definition);
    expect(calls[0].variables.type).toBe("$app:aces_bundle_publication_record_dev");
  });

  it("rejects a Metaobject create when Shopify cannot read the written document back", async () => {
    const target = { ...definition, revision_id: "new" };
    const execute = async (query, { variables }) => {
      if (query.includes("BundlePersistenceMetaobjectCreate")) {
        return { data: { metaobjectCreate: { metaobject: { fields: [{ key: "document", jsonValue: target }] }, userErrors: [] } } };
      }
      if (query.includes("BundlePersistenceMetaobject($type")) {
        return { data: { metaobjectByHandle: null } };
      }
      throw new Error(`unexpected Shopify operation: ${variables.type}`);
    };
    const adapter = createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID });

    await expect(adapter.writeRevision({ revision: target })).rejects.toMatchObject({
      code: "READ_BACK_FAILED",
      details: expect.objectContaining({ source: "read_back", handle: "new" }),
    });
  });

  it("rejects a Metaobject update when Shopify cannot read the written document back", async () => {
    const existing = { ...definition, revision_id: "old" };
    const target = { ...definition, revision_id: "new" };
    let document = existing;
    const execute = async (query, { variables }) => {
      if (query.includes("BundlePersistenceMetaobjectUpdate")) {
        return { data: { metaobjectUpdate: { metaobject: { fields: [{ key: "document", jsonValue: target }] }, userErrors: [] } } };
      }
      if (query.includes("BundlePersistenceMetaobject($type")) {
        return { data: { metaobjectByHandle: { id: "gid://shopify/Metaobject/1", fields: [{ key: "document", jsonValue: document }] } } };
      }
      throw new Error(`unexpected Shopify operation: ${variables.type}`);
    };
    const adapter = createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID });

    await expect(adapter.writeRevision({ revision: target })).rejects.toMatchObject({
      code: "READ_BACK_FAILED",
      details: expect.objectContaining({ source: "read_back", handle: "new" }),
    });
    document = target;
  });

  it("returns an updated Metaobject only after read-back parity", async () => {
    const existing = { ...definition, revision_id: "old" };
    const target = { ...definition, revision_id: "new" };
    let document = existing;
    const execute = async (query, { variables }) => {
      if (query.includes("BundlePersistenceMetaobjectUpdate")) {
        document = JSON.parse(variables.metaobject.fields[0].value);
        return { data: { metaobjectUpdate: { metaobject: { fields: [{ key: "document", jsonValue: document }] }, userErrors: [] } } };
      }
      if (query.includes("BundlePersistenceMetaobject($type")) {
        return { data: { metaobjectByHandle: { id: "gid://shopify/Metaobject/1", fields: [{ key: "document", jsonValue: document }] } } };
      }
      throw new Error(`unexpected Shopify operation: ${variables.type}`);
    };
    const adapter = createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID });

    await expect(adapter.writeRevision({ revision: target })).resolves.toEqual(target);
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

  it("writes a validated pre-built projection with checksum CAS and read-back", async () => {
    const target = projectionFixture();
    const { adapter, calls } = createAdapter({ projection: null });

    await expect(adapter.writePrebuiltExpandProjection({
      bundle_definition_id: definition.bundle_definition_id,
      expected_previous_projection_checksum: null,
      target_revision_id: target.published_revision_id,
      target_projection_checksum: target.checksum,
      publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
      projection: target,
    })).resolves.toEqual(target);
    const write = calls.find((call) => call.query.includes("BundlePersistenceMetafieldsSet"));
    expect(write.variables.metafields[0]).toMatchObject({
      namespace: "aces_dev",
      key: "prebuilt_bundle_expand_projection_v1",
      compareDigest: null,
    });
  });

  it("rejects projection drift and projection tampering before persistence", async () => {
    const target = projectionFixture();
    const tampered = { ...target, parent: { ...target.parent, title: "Tampered" } };
    const { adapter } = createAdapter({ projection: target });
    const base = {
      bundle_definition_id: definition.bundle_definition_id,
      expected_previous_projection_checksum: "wrong",
      target_revision_id: target.published_revision_id,
      target_projection_checksum: target.checksum,
      publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
    };

    await expect(adapter.writePrebuiltExpandProjection({ ...base, projection: target }))
      .rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
    await expect(adapter.writePrebuiltExpandProjection({ ...base, projection: tampered }))
      .rejects.toMatchObject({ code: "WRITE_FAILED" });
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

  it("allows the first isolated Snapshot write when no previous Snapshot exists", async () => {
    const { adapter, calls } = createAdapter({ snapshot: null });

    await expect(adapter.writeRuntimeSnapshot({
      bundle_definition_id: definition.bundle_definition_id,
      expected_previous_snapshot_checksum: null,
      target_revision_id: "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702",
      target_snapshot_checksum: targetSnapshot.checksum,
      publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
      snapshot: targetSnapshot,
    })).resolves.toEqual(targetSnapshot);

    expect(calls.some((call) => call.query.includes("BundlePersistenceMetafieldsSet"))).toBe(true);
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

  it("reads the external active revision pointer before a publication CAS", async () => {
    const { adapter, calls } = createAdapter();

    await expect(adapter.readActiveRevisionId(definition.bundle_definition_id))
      .resolves.toBe(definition.active_revision_id);
    const pointerRead = calls.find((call) => (
      call.query.includes("BundlePersistenceProductMetafield")
      && call.variables.key === "active_revision_id_v1"
    ));
    expect(pointerRead.variables.namespace).toBe("aces_dev");
  });

  it("uses explicitly isolated dev rehearsal carriers without falling back to primary keys", async () => {
    const bindings = {
      metaobjectTypes: {
        bundleDefinition: "$app:aces_bundle_definition_dev",
        bundleRevision: "$app:aces_bundle_revision_dev",
        publicationRecord: "$app:aces_bundle_publication_record_dev",
      },
      documentFieldKey: "document",
      metafields: {
        namespace: "aces_dev",
        runtimeSnapshotKey: "bundle_runtime_snapshot_publication_rehearsal_v1",
        activeRevisionKey: "active_revision_id_publication_rehearsal_v1",
      },
    };
    const { adapter, calls } = createAdapter({ bindings });

    await adapter.writeRuntimeSnapshot({
      bundle_definition_id: definition.bundle_definition_id,
      expected_previous_snapshot_checksum: previousSnapshot.checksum,
      target_revision_id: "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702",
      target_snapshot_checksum: targetSnapshot.checksum,
      publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
      snapshot: targetSnapshot,
    });
    await adapter.compareAndSetActiveRevision({
      bundle_definition_id: definition.bundle_definition_id,
      expected_active_revision_id: definition.active_revision_id,
      target_revision_id: "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702",
      publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
    });

    const keys = calls
      .filter((call) => call.query.includes("BundlePersistenceProductMetafield"))
      .map((call) => call.variables.key)
      .concat(calls
        .filter((call) => call.query.includes("BundlePersistenceMetafieldsSet"))
        .map((call) => call.variables.metafields[0].key));
    expect(keys).toContain("bundle_runtime_snapshot_publication_rehearsal_v1");
    expect(keys).toContain("active_revision_id_publication_rehearsal_v1");
    expect(keys).not.toContain("bundle_runtime_snapshot_v1");
    expect(keys).not.toContain("active_revision_id_v1");
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

  it("persists pre-built import ledger transitions on the Shop owner with compareDigest CAS", async () => {
    let stored = null;
    let compareDigest = null;
    const writes = [];
    const execute = async (query, { variables }) => {
      if (query.includes("BundlePersistenceShopMetafield")) {
        return { data: { shop: {
          id: "gid://shopify/Shop/1",
          metafield: stored === null ? null : {
            type: "json",
            value: JSON.stringify(stored),
            jsonValue: stored,
            compareDigest,
          },
        } } };
      }
      if (query.includes("BundlePersistenceMetafieldsSet")) {
        const field = variables.metafields[0];
        writes.push(structuredClone(field));
        stored = JSON.parse(field.value);
        compareDigest = `digest-${writes.length}`;
        return { data: { metafieldsSet: { metafields: [{
          type: "json", value: field.value, jsonValue: stored, compareDigest,
        }], userErrors: [] } } };
      }
      throw new Error("unexpected Shopify operation");
    };
    const adapter = createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID });
    const pending = ledgerRecord();
    const completed = { ...pending, state: "completed", completed_at: "2026-07-20T06:00:01.000Z" };

    await expect(adapter.readPrebuiltImportLedger(pending.source_identity)).resolves.toBeNull();
    await expect(adapter.writePrebuiltImportLedger(pending)).resolves.toEqual(pending);
    await expect(adapter.writePrebuiltImportLedger(completed)).resolves.toEqual(completed);
    await expect(adapter.readPrebuiltImportLedger(pending.source_identity)).resolves.toEqual(completed);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      ownerId: "gid://shopify/Shop/1",
      namespace: "aces_dev",
      compareDigest: null,
    });
    expect(writes[0].key).toMatch(/^prebuilt_import_ledger_v1_[0-9a-f]{32}$/);
    expect(writes[1].compareDigest).toBe("digest-1");
  });

  it("reads up to 25 import ledgers in one read-only Shop metafield query", async () => {
    const first = ledgerRecord();
    const second = {
      ...first,
      import_id: "77770000-0000-4000-8000-000000000002",
      source_identity: "shopify://source-store/products/3/variants/4",
    };
    const calls = [];
    const execute = async (query, { variables }) => {
      calls.push({ query, variables });
      if (!query.includes("BundlePersistenceShopImportLedgers")) {
        throw new Error("unexpected Shopify operation");
      }
      const [firstKey, secondKey] = variables.keys;
      return { data: { shop: {
        id: "gid://shopify/Shop/1",
        metafields: {
          nodes: [
            { key: firstKey.split(".").at(-1), type: "json", value: JSON.stringify(first), jsonValue: first },
            { key: secondKey.split(".").at(-1), type: "json", value: JSON.stringify(second), jsonValue: second },
          ],
        },
      } } };
    };
    const adapter = createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID });

    await expect(adapter.readPrebuiltImportLedgers([first.source_identity, second.source_identity]))
      .resolves.toEqual([first, second]);
    expect(calls).toHaveLength(1);
    expect(calls[0].variables).toMatchObject({ first: 2 });
    expect(calls[0].variables.keys).toHaveLength(2);
    expect(calls[0].query).not.toContain("mutation ");
  });

  it("rejects oversized import ledger batches before Shopify is called", async () => {
    const execute = vi.fn();
    const adapter = createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID });

    await expect(adapter.readPrebuiltImportLedgers(
      Array.from({ length: 26 }, (_, index) => `source-${index}`),
    )).rejects.toMatchObject({ code: "READ_BACK_FAILED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects ledger target drift and maps concurrent CAS loss to a checksum conflict", async () => {
    const pending = ledgerRecord();
    const execute = async (query) => {
      if (query.includes("BundlePersistenceShopMetafield")) {
        return { data: { shop: { id: "gid://shopify/Shop/1", metafield: null } } };
      }
      if (query.includes("BundlePersistenceMetafieldsSet")) {
        return { data: { metafieldsSet: {
          metafields: [],
          userErrors: [{ code: "INVALID_COMPARE_DIGEST", message: "stale ledger" }],
        } } };
      }
      throw new Error("unexpected Shopify operation");
    };
    const adapter = createDevShopifyPersistenceAdapter({ execute, appClientId: DEV_SHOPIFY_APP_CLIENT_ID });
    await expect(adapter.writePrebuiltImportLedger(pending))
      .rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });

    let stored = pending;
    const driftAdapter = createDevShopifyPersistenceAdapter({
      appClientId: DEV_SHOPIFY_APP_CLIENT_ID,
      execute: async (query) => {
        if (query.includes("BundlePersistenceShopMetafield")) {
          return { data: { shop: { id: "gid://shopify/Shop/1", metafield: {
            type: "json", value: JSON.stringify(stored), jsonValue: stored, compareDigest: "digest-1",
          } } } };
        }
        throw new Error("unexpected Shopify operation");
      },
    });
    await expect(driftAdapter.writePrebuiltImportLedger({
      ...pending,
      state: "completed",
      target_fingerprint: "different-target",
    })).rejects.toMatchObject({ code: "RETRY_CONFLICT" });
    stored = { ...pending, state: "completed", completed_at: "2026-07-20T06:00:01.000Z" };
    await expect(driftAdapter.writePrebuiltImportLedger({
      ...pending,
      state: "failed",
      failed_at: "2026-07-20T06:00:02.000Z",
    })).rejects.toMatchObject({ code: "RETRY_CONFLICT" });
  });
});

function ledgerRecord() {
  return {
    schema_version: "prebuilt_bundle_import_ledger.v1",
    import_id: "77770000-0000-4000-8000-000000000001",
    source_identity: "shopify://source-store/products/1/variants/2",
    source_fingerprint: "source-fingerprint",
    target_bundle_definition_id: definition.bundle_definition_id,
    target_fingerprint: "target-fingerprint",
    state: "pending",
    created_at: "2026-07-20T06:00:00.000Z",
    updated_at: "2026-07-20T06:00:00.000Z",
  };
}
