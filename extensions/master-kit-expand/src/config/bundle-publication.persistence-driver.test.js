import { describe, expect, it } from "vitest";
import { createInMemoryBundlePersistenceAdapter } from "./bundle-persistence.in-memory-adapter.js";
import { createBundlePublicationPersistenceDriver } from "./bundle-publication.persistence-driver.js";
import { publishDraftRevision } from "./bundle-publication.service.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import {
  DEV_SHOPIFY_APP_CLIENT_ID,
  DEV_SHOPIFY_PERSISTENCE_BINDINGS,
  createDevShopifyPersistenceAdapter,
} from "./shopify-dev-persistence.adapter.js";

const definitionId = "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89";
const activeRevisionId = "0a9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef701";
const draftRevisionId = "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702";
const at = "2026-07-16T00:00:00Z";

function promotion(snapshot, revisionId = draftRevisionId) {
  return {
    evidence: {
      schema_version: "bundle_publication_promotion_evidence.v1",
      bundle_definition_id: definitionId,
      revision_id: revisionId,
      snapshot_checksum: snapshot.checksum,
      fixture_set_id: "persistence-driver-test",
      fixtures: [{
        fixture_id: "persistence-driver-test",
        hardcoded_result: { operations: [] },
        candidate_result: { operations: [] },
      }],
    },
  };
}

function configuration(version, status) {
  const value = structuredClone(masterKitConfigV1);
  value.configuration_id = definitionId;
  value.configuration_version = version;
  value.status = status;
  value.revision.draft_revision = version;
  value.revision.published_revision = version;
  return value;
}

function definition() {
  return {
    schema_version: "bundle_definition.v1",
    bundle_definition_id: definitionId,
    slug: "aces-master-kit",
    parent_binding: {
      product_gid: masterKitConfigV1.parent.product_gid,
      variant_gid: masterKitConfigV1.parent.variant_gid,
    },
    active_revision_id: activeRevisionId,
    created_at: at,
    updated_at: at,
  };
}

function revision({ revisionId, revisionNumber, status }) {
  const config = configuration(revisionNumber, status === "draft" ? "draft" : "active");
  const snapshot = status === "draft" ? null : compileRuntimeSnapshot(config);
  return {
    schema_version: "bundle_revision.v1",
    revision_id: revisionId,
    bundle_definition_id: definitionId,
    revision_number: revisionNumber,
    status,
    configuration: config,
    runtime_snapshot_ref: snapshot && {
      schema_version: snapshot.snapshot_schema,
      checksum_algorithm: snapshot.checksum_algorithm,
      checksum: snapshot.checksum,
      configuration_version: revisionNumber,
    },
    created_at: at,
    updated_at: at,
    created_by: "publication-driver-test",
  };
}

describe("bundle publication persistence driver", () => {
  it("persists the domain lifecycle through the normalized adapter after Snapshot and pointer gates", async () => {
    const active = revision({ revisionId: activeRevisionId, revisionNumber: 1, status: "published" });
    const draft = revision({ revisionId: draftRevisionId, revisionNumber: 2, status: "draft" });
    const currentSnapshot = compileRuntimeSnapshot(active.configuration);
    const persistence = createInMemoryBundlePersistenceAdapter({
      definitions: [definition()],
      revisions: [active, draft],
      snapshots: { [definitionId]: currentSnapshot },
    });
    const result = await publishDraftRevision({
      publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
      definition: definition(),
      revisions: [active, draft],
      revision_id: draftRevisionId,
      promotion: promotion(compileRuntimeSnapshot(draft.configuration)),
      at,
    }, createBundlePublicationPersistenceDriver({ persistence }));

    expect(result).toMatchObject({ success: true, active_revision_id: draftRevisionId });
    expect(persistence.state.definitionStore.get(definitionId).active_revision_id).toBe(draftRevisionId);
    expect(persistence.state.revisionStore.get(activeRevisionId).status).toBe("superseded");
    expect(persistence.state.revisionStore.get(draftRevisionId).status).toBe("published");
    expect(persistence.state.snapshotStore.get(definitionId).checksum).toBe(result.snapshot_checksum);
    expect(persistence.state.publicationStore.get(result.publication_id).result.success).toBe(true);
  });

  it("fails closed when the persistence adapter cannot read the external active pointer", () => {
    const persistence = createInMemoryBundlePersistenceAdapter();
    delete persistence.readActiveRevisionId;

    expect(() => createBundlePublicationPersistenceDriver({ persistence })).toThrow(
      /readActiveRevisionId/,
    );
  });

  it("executes the complete lifecycle through the stateful Shopify Admin GraphQL transport", async () => {
    const active = revision({ revisionId: activeRevisionId, revisionNumber: 1, status: "published" });
    const draft = revision({ revisionId: draftRevisionId, revisionNumber: 2, status: "draft" });
    const state = createShopifyTransportState({
      definition: definition(),
      revisions: [active, draft],
      snapshot: compileRuntimeSnapshot(active.configuration),
      activeRevisionId,
    });
    const persistence = createDevShopifyPersistenceAdapter({
      appClientId: DEV_SHOPIFY_APP_CLIENT_ID,
      execute: state.execute,
    });

    const result = await publishDraftRevision({
      publication_id: "3b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef704",
      definition: definition(),
      revisions: [active, draft],
      revision_id: draftRevisionId,
      promotion: promotion(compileRuntimeSnapshot(draft.configuration)),
      at,
    }, createBundlePublicationPersistenceDriver({ persistence }));

    expect(result.success).toBe(true);
    expect(state.activeRevisionId).toBe(draftRevisionId);
    expect(state.documents.get(documentKey(DEV_SHOPIFY_PERSISTENCE_BINDINGS.metaobjectTypes.bundleDefinition, definitionId)).active_revision_id)
      .toBe(draftRevisionId);
    expect(state.documents.get(documentKey(DEV_SHOPIFY_PERSISTENCE_BINDINGS.metaobjectTypes.bundleRevision, activeRevisionId)).status)
      .toBe("superseded");
    expect(state.documents.get(documentKey(DEV_SHOPIFY_PERSISTENCE_BINDINGS.metaobjectTypes.bundleRevision, draftRevisionId)).status)
      .toBe("published");
    expect(state.documents.get(documentKey(DEV_SHOPIFY_PERSISTENCE_BINDINGS.metaobjectTypes.publicationRecord, result.publication_id)).result.success)
      .toBe(true);
    expect(state.calls.filter((call) => call.query.includes("BundlePersistenceMetafieldsSet"))).toHaveLength(2);
  });
});

function createShopifyTransportState({ definition: definitionDocument, revisions, snapshot, activeRevisionId: initialActiveRevisionId }) {
  const documents = new Map();
  const ids = new Map();
  const calls = [];
  let nextId = 1;
  let activeRevisionId = initialActiveRevisionId;
  let currentSnapshot = structuredClone(snapshot);
  let snapshotDigest = "snapshot-digest-1";
  let pointerDigest = "pointer-digest-1";

  addDocument(DEV_SHOPIFY_PERSISTENCE_BINDINGS.metaobjectTypes.bundleDefinition, definitionDocument.bundle_definition_id, definitionDocument);
  revisions.forEach((item) => addDocument(DEV_SHOPIFY_PERSISTENCE_BINDINGS.metaobjectTypes.bundleRevision, item.revision_id, item));

  return {
    documents,
    calls,
    get activeRevisionId() { return activeRevisionId; },
    async execute(query, { variables }) {
      calls.push({ query, variables });
      if (query.includes("BundlePersistenceMetaobjectCreate")) {
        const document = JSON.parse(variables.metaobject.fields[0].value);
        addDocument(variables.metaobject.type, variables.metaobject.handle, document);
        return metaobjectCreateResponse(document);
      }
      if (query.includes("BundlePersistenceMetaobjectUpdate")) {
        const key = [...ids.entries()].find(([, id]) => id === variables.id)?.[0];
        const document = JSON.parse(variables.metaobject.fields[0].value);
        documents.set(key, document);
        return { data: { metaobjectUpdate: { metaobject: metaobjectFields(document), userErrors: [] } } };
      }
      if (query.includes("BundlePersistenceMetaobject($type")) {
        const document = documents.get(documentKey(variables.type, variables.handle)) ?? null;
        return { data: { metaobjectByHandle: document === null ? null : {
          id: ids.get(documentKey(variables.type, variables.handle)),
          ...metaobjectFields(document),
        } } };
      }
      if (query.includes("BundlePersistenceProductMetafield")) {
        const isSnapshot = variables.key === DEV_SHOPIFY_PERSISTENCE_BINDINGS.metafields.runtimeSnapshotKey;
        const value = isSnapshot ? currentSnapshot : activeRevisionId;
        const digest = isSnapshot ? snapshotDigest : pointerDigest;
        return { data: { product: { metafield: value === null ? null : {
          type: isSnapshot ? "json" : "single_line_text_field",
          value: isSnapshot ? JSON.stringify(value) : value,
          jsonValue: isSnapshot ? value : null,
          compareDigest: digest,
        } } } };
      }
      if (query.includes("BundlePersistenceMetafieldsSet")) {
        const field = variables.metafields[0];
        const isSnapshot = field.key === DEV_SHOPIFY_PERSISTENCE_BINDINGS.metafields.runtimeSnapshotKey;
        if (field.compareDigest !== (isSnapshot ? snapshotDigest : pointerDigest)) {
          return { data: { metafieldsSet: { metafields: [], userErrors: [{ code: "INVALID_COMPARE_DIGEST", message: "stale" }] } } };
        }
        if (isSnapshot) {
          currentSnapshot = JSON.parse(field.value);
          snapshotDigest = "snapshot-digest-2";
        } else {
          activeRevisionId = field.value;
          pointerDigest = "pointer-digest-2";
        }
        return { data: { metafieldsSet: { metafields: [{
          type: field.type,
          value: field.value,
          jsonValue: isSnapshot ? currentSnapshot : null,
          compareDigest: isSnapshot ? snapshotDigest : pointerDigest,
        }], userErrors: [] } } };
      }
      throw new Error("unexpected Shopify operation");
    },
  };

  function addDocument(type, handle, document) {
    const key = documentKey(type, handle);
    documents.set(key, structuredClone(document));
    ids.set(key, `gid://shopify/Metaobject/${nextId++}`);
  }
}

function documentKey(type, handle) {
  return `${type}:${handle}`;
}

function metaobjectFields(document) {
  return { fields: [{ key: "document", jsonValue: structuredClone(document) }] };
}

function metaobjectCreateResponse(document) {
  return { data: { metaobjectCreate: { metaobject: metaobjectFields(document), userErrors: [] } } };
}
