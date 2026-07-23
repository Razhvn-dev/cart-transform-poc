import { describe, expect, it, vi } from "vitest";
import {
  DEV_SHOPIFY_APP_CLIENT_ID,
  createDevShopifyBundleAdminService,
  createPrebuiltImportComposition,
} from "./bundle-admin.shopify-service.server.js";
import { createBundleAdminRouteHandlers } from "./bundle-admin.http.server.js";
import { masterKitConfigV1 } from "../../../extensions/master-kit-expand/src/config/fixtures/master-kit-config.v1.js";
import { importFixture } from "../../../extensions/master-kit-expand/src/config/prebuilt-bundle-import.plan.test-fixture.js";

const definitionId = "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89";
const revisionId = "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702";

function createTransport({ staleRevisionUpdate = false, staleReadAfterRevisionUpdate = false } = {}) {
  const documents = new Map();
  const productMetafields = new Map();
  const shopMetafields = new Map();
  let metafieldSerial = 0;
  let stale = staleRevisionUpdate;
  let staleReadDocument = null;
  const calls = [];
  const admin = {
    async graphql(query, { variables }) {
      calls.push({ query, variables });
      if (query.includes("BundlePersistenceMetaobjects")) {
        return { data: { metaobjects: { nodes: [...documents.values()]
          .filter((entry) => entry.type === variables.type)
          .map(({ document }) => ({ fields: fields(document) })) } } };
      }
      if (query.includes("BundlePersistenceMetaobject($type")) {
        const entry = documents.get(key(variables.type, variables.handle));
        const document = staleReadDocument ?? entry?.document;
        staleReadDocument = null;
        return { data: { metaobjectByHandle: entry ? { id: entry.id, fields: fields(document) } : null } };
      }
      if (query.includes("BundlePersistenceMetaobjectCreate")) {
        const input = variables.metaobject;
        const document = JSON.parse(input.fields[0].value);
        const entry = { id: `gid://shopify/Metaobject/${documents.size + 1}`, type: input.type, document };
        documents.set(key(input.type, input.handle), entry);
        return { data: { metaobjectCreate: { metaobject: { id: entry.id, fields: fields(document) }, userErrors: [] } } };
      }
      if (query.includes("BundlePersistenceMetaobjectUpdate")) {
        if (stale) {
          stale = false;
          return { data: { metaobjectUpdate: { metaobject: null, userErrors: [{ code: "STALE_OBJECT", message: "stale object" }] } } };
        }
        const entry = [...documents.values()].find((candidate) => candidate.id === variables.id);
        const previousDocument = entry.document;
        entry.document = JSON.parse(variables.metaobject.fields[0].value);
        if (staleReadAfterRevisionUpdate) staleReadDocument = previousDocument;
        return { data: { metaobjectUpdate: { metaobject: { id: entry.id, fields: fields(entry.document) }, userErrors: [] } } };
      }
      if (query.includes("BundlePersistenceProductMetafield")) {
        const entry = productMetafields.get(`${variables.productId}:${variables.namespace}:${variables.key}`) ?? null;
        return { data: { product: { metafield: entry } } };
      }
      if (query.includes("BundlePersistenceShopImportLedgers")) {
        const requestedKeys = new Set(variables.keys.map((value) => value.split(".").at(-1)));
        const nodes = [...shopMetafields.entries()]
          .filter(([compoundKey]) => requestedKeys.has(compoundKey.split(":").at(-1)))
          .map(([compoundKey, entry]) => ({ key: compoundKey.split(":").at(-1), ...entry }));
        return { data: { shop: {
          id: "gid://shopify/Shop/1",
          metafields: { nodes },
        } } };
      }
      if (query.includes("BundlePersistenceShopMetafield")) {
        const entry = shopMetafields.get(`${variables.namespace}:${variables.key}`) ?? null;
        return { data: { shop: { id: "gid://shopify/Shop/1", metafield: entry } } };
      }
      if (query.includes("BundlePersistenceMetafieldsSet")) {
        const input = variables.metafields[0];
        const entry = {
          type: input.type,
          value: input.value,
          jsonValue: input.type === "json" ? JSON.parse(input.value) : null,
          compareDigest: `digest-${++metafieldSerial}`,
        };
        if (input.ownerId.startsWith("gid://shopify/Shop/")) {
          shopMetafields.set(`${input.namespace}:${input.key}`, entry);
        } else {
          productMetafields.set(`${input.ownerId}:${input.namespace}:${input.key}`, entry);
        }
        return { data: { metafieldsSet: { metafields: [entry], userErrors: [] } } };
      }
      throw new Error("unexpected Shopify operation");
    },
  };
  return { admin, documents, productMetafields, shopMetafields, calls };
}

function config(version = 1) {
  const value = structuredClone(masterKitConfigV1);
  value.configuration_id = definitionId;
  value.configuration_version = version;
  value.status = "draft";
  value.revision.draft_revision = version;
  value.revision.published_revision = version;
  return value;
}

function service(transport, options = {}) {
  return createDevShopifyBundleAdminService({
    admin: transport.admin,
    appClientId: DEV_SHOPIFY_APP_CLIENT_ID,
    ...options,
  });
}

function definitionInput() {
  return {
    bundle_definition_id: definitionId,
    slug: "aces-master-kit",
    parent_binding: {
      product_gid: masterKitConfigV1.parent.product_gid,
      variant_gid: masterKitConfigV1.parent.variant_gid,
    },
    created_by: "test.myshopify.com",
  };
}

describe("Bundle Admin Shopify dev persistence composition", () => {
  it("keeps pre-built import execution fail-closed unless its dedicated server opt-in is enabled", () => {
    const persistence = { readPrebuiltImportLedger: vi.fn() };
    expect(createPrebuiltImportComposition({ persistence, enabled: false }))
      .toEqual({
        enabled: false,
        executor: null,
        ledger: null,
        ledgerReader: { read: expect.any(Function) },
        createTargetWriter: null,
      });
    expect(() => createPrebuiltImportComposition({ persistence, enabled: true }))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_CAPABILITY" }));
  });

  it("composes the durable import executor only from a CAS-capable persistence adapter", () => {
    const persistence = {
      readPrebuiltImportLedger: vi.fn(),
      writePrebuiltImportLedger: vi.fn(),
    };
    const composition = createPrebuiltImportComposition({ persistence, enabled: true });
    expect(composition).toMatchObject({
      enabled: true,
      executor: expect.any(Function),
      ledger: { read: expect.any(Function), write: expect.any(Function) },
      ledgerReader: { read: expect.any(Function) },
      createTargetWriter: expect.any(Function),
    });
  });

  it("composes recovery assessment as read-only even when import execution is disabled", async () => {
    const transport = createTransport();
    const app = service(transport);

    const result = await app.assessPrebuiltBundleImportRecovery({
      import_package: importFixture(),
      source_identities: ["legacy_paid_app:legacy-master-kit-1"],
    });

    expect(result).toMatchObject({ summary: { ready_to_execute: 1 } });
    expect(transport.calls.filter((call) => call.query.includes("BundlePersistenceShopImportLedgers"))).toHaveLength(1);
    expect(transport.calls.some((call) => call.query.includes("BundlePersistenceShopMetafield("))).toBe(false);
    expect(transport.calls.some((call) => call.query.includes("BundlePersistenceMetafieldsSet"))).toBe(false);
    expect(transport.documents.size).toBe(0);
    expect(transport.productMetafields.size).toBe(0);
    expect(transport.shopMetafields.size).toBe(0);
  });

  it("runs the guarded pre-built import chain to durable Shopify-shaped state and retries idempotently", async () => {
    const transport = createTransport();
    const app = service(transport, { prebuiltImportExecutionEnabled: true });
    const packageValue = importFixture();
    const reviewed = await app.reviewPrebuiltBundleImport({ import_package: packageValue });
    const input = {
      import_package: packageValue,
      confirmation_token: reviewed.confirmation_token,
      confirmation: `IMPORT:${reviewed.import_id}:${reviewed.confirmation_token}`,
    };

    const firstResult = await app.executePrebuiltBundleImport(input);
    expect(firstResult, JSON.stringify(firstResult)).toMatchObject({
      completed: 1,
      failed: 0,
      already_completed: 0,
    });
    await expect(app.executePrebuiltBundleImport(input)).resolves.toMatchObject({
      completed: 0,
      failed: 0,
      already_completed: 1,
    });
    expect([...transport.documents.values()].some((entry) => (
      entry.type === "$app:aces_bundle_definition_dev" && entry.document.active_revision_id
    ))).toBe(true);
    expect(transport.productMetafields.size).toBe(3);
    expect(transport.shopMetafields.size).toBe(1);
    expect([...transport.shopMetafields.values()][0].jsonValue.state).toBe("completed");
  });

  it("lists an empty dev store, then creates, lists, and reads a bundle definition", async () => {
    const transport = createTransport();
    const app = service(transport);

    await expect(app.listBundles()).resolves.toEqual([]);
    await app.createBundleDefinition(definitionInput());
    await expect(app.listBundles()).resolves.toEqual([expect.objectContaining({ bundle_definition_id: definitionId })]);
    await expect(app.getBundleDetail({ bundle_definition_id: definitionId }))
      .resolves.toMatchObject({ definition: { bundle_definition_id: definitionId }, revisions: [] });
    expect(transport.calls.some((call) => call.variables?.type === "$app:aces_bundle_definition_dev")).toBe(true);
  });

  it("normalizes a Bundle Admin list read failure as persistence failure", async () => {
    const app = service({ admin: { graphql: async () => { throw new Error("malformed upstream response"); } } });

    await expect(app.listBundles()).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
  });

  it("creates and updates a draft, returns revision history, validation, and compile preview", async () => {
    const transport = createTransport();
    const app = service(transport);
    await app.createBundleDefinition(definitionInput());
    const draft = await app.createDraftRevision({
      bundle_definition_id: definitionId,
      revision_id: revisionId,
      configuration: config(),
      created_by: "test.myshopify.com",
    });
    const edited = config();
    edited.internal_name = "Shopify persisted draft";
    await app.updateDraftRevision({ revision_id: draft.revision_id, configuration: edited, updated_by: "test.myshopify.com" });

    await expect(app.listRevisionHistory({ bundle_definition_id: definitionId }))
      .resolves.toEqual([expect.objectContaining({ revision_id: revisionId, status: "draft" })]);
    await expect(app.validateDraft({ revision_id: revisionId })).resolves.toMatchObject({ valid: true });
    await expect(app.compilePreview({ revision_id: revisionId })).resolves.toMatchObject({
      valid: true,
      configuration_version: 1,
      snapshot_checksum: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
  });

  it("normalizes a missing Shopify Metaobject as not found", async () => {
    const app = service(createTransport());
    await expect(app.getBundleDetail({ bundle_definition_id: definitionId }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps Shopify publication disabled unless both server-side controls are configured", async () => {
    const transport = createTransport();
    const app = service(transport);
    await app.createBundleDefinition(definitionInput());
    await app.createDraftRevision({
      bundle_definition_id: definitionId,
      revision_id: revisionId,
      configuration: config(),
      created_by: "test.myshopify.com",
    });

    await expect(app.publishDraftRevision({
      revision_id: revisionId,
      publication_id: "21111111-1111-4111-8111-000000000001",
      confirmation: `PUBLISH:${definitionId}:${revisionId}`,
    })).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
    expect(transport.calls.some((call) => call.query.includes("MetafieldsSet"))).toBe(false);
  });

  it.each([
    ["only the server opt-in", { publicationEnabled: true }],
    ["only the evidence directory", { publicationEvidenceDirectory: "C:/server-owned-evidence" }],
  ])("keeps publication disabled with %s", async (_label, options) => {
    const transport = createTransport();
    const app = service(transport, options);
    await app.createBundleDefinition(definitionInput());
    await app.createDraftRevision({
      bundle_definition_id: definitionId,
      revision_id: revisionId,
      configuration: config(),
      created_by: "test.myshopify.com",
    });

    await expect(app.getBundleDetail({ bundle_definition_id: definitionId }))
      .resolves.toMatchObject({ publication: { enabled: false, requires_server_evidence: true } });
    await expect(app.publishDraftRevision({
      revision_id: revisionId,
      publication_id: "21111111-1111-4111-8111-000000000001",
      confirmation: `PUBLISH:${definitionId}:${revisionId}`,
    })).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
    expect(transport.calls.some((call) => call.query.includes("MetafieldsSet"))).toBe(false);
  });

  it("reads publication audit records only from the canonical development Metaobject type", async () => {
    const transport = createTransport();
    const app = service(transport);
    await app.createBundleDefinition(definitionInput());

    await expect(app.listPublicationHistory({ bundle_definition_id: definitionId })).resolves.toEqual([]);
    expect(transport.calls.some((call) => (
      call.query.includes("BundlePersistenceMetaobjects")
      && call.variables.type === "$app:aces_bundle_publication_record_dev"
    ))).toBe(true);
  });

  it("normalizes stale Shopify GraphQL user errors as an application conflict", async () => {
    const transport = createTransport({ staleRevisionUpdate: true });
    const app = service(transport);
    await app.createBundleDefinition(definitionInput());
    await app.createDraftRevision({
      bundle_definition_id: definitionId,
      revision_id: revisionId,
      configuration: config(),
      created_by: "test.myshopify.com",
    });
    await expect(app.updateDraftRevision({
      revision_id: revisionId,
      configuration: config(),
      updated_by: "test.myshopify.com",
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an apparent draft update when the durable read-back still returns the old document", async () => {
    const transport = createTransport({ staleReadAfterRevisionUpdate: true });
    const app = service(transport);
    await app.createBundleDefinition(definitionInput());
    await app.createDraftRevision({
      bundle_definition_id: definitionId,
      revision_id: revisionId,
      configuration: config(),
      created_by: "test.myshopify.com",
    });
    const edited = config();
    edited.internal_name = "Must be durably confirmed";

    await expect(app.updateDraftRevision({
      revision_id: revisionId,
      configuration: edited,
      updated_by: "test.myshopify.com",
    })).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED",
      details: expect.objectContaining({ source: "read_back", handle: revisionId }),
    });
  });

  it("returns PERSISTENCE_FAILED from the authenticated route when read-back is stale", async () => {
    const transport = createTransport({ staleReadAfterRevisionUpdate: true });
    const app = service(transport);
    await app.createBundleDefinition(definitionInput());
    await app.createDraftRevision({
      bundle_definition_id: definitionId,
      revision_id: revisionId,
      configuration: config(),
      created_by: "test.myshopify.com",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const routes = createBundleAdminRouteHandlers({
      authenticateAdmin: async () => ({ session: { shop: "test.myshopify.com" } }),
      getService: () => app,
    });
    const edited = config();
    edited.internal_name = "Must not report a stale save as success";

    const response = await routes.updateDraftRevision({
      request: new Request("https://example.test/app/bundle-admin/revisions/test", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ configuration: edited }),
      }),
      params: { revisionId },
    });
    errorSpy.mockRestore();

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "PERSISTENCE_FAILED",
        details: { source: "read_back", handle: revisionId },
      },
    });
    expect(response.status).toBe(500);
  });
});

function key(type, handle) {
  return `${type}:${handle}`;
}

function fields(document) {
  return [{ key: "document", value: JSON.stringify(document), jsonValue: document }];
}
