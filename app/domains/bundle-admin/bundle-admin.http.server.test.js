import { describe, expect, it, vi } from "vitest";
import { BundleAdminApplicationError } from "./bundle-admin.service.js";
import { createBundleAdminHttpResponse, createBundleAdminRouteHandlers } from "./bundle-admin.http.server.js";

const definitionId = "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89";
const revisionId = "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702";

function handlers({ authenticateAdmin = async () => ({ session: { shop: "test.myshopify.com" } }), service = serviceStub() } = {}) {
  return { routes: createBundleAdminRouteHandlers({ authenticateAdmin, service }), service };
}

function serviceStub() {
  return {
    listBundles: vi.fn(() => []),
    getBundleDetail: vi.fn(() => ({ definition: { bundle_definition_id: definitionId }, revisions: [] })),
    createBundleDefinition: vi.fn(() => ({ definition: { bundle_definition_id: definitionId }, revisions: [] })),
    updateBundleDefinition: vi.fn(() => ({ definition: { bundle_definition_id: definitionId }, revisions: [] })),
    createDraftRevision: vi.fn(() => ({ revision_id: revisionId, status: "draft" })),
    reviewPrebuiltBundleImport: vi.fn(() => ({ mode: "dry_run", records: [] })),
    executePrebuiltBundleImport: vi.fn(() => ({ completed: 1, failed: 0 })),
    cloneActiveRevisionToDraft: vi.fn(() => ({ revision_id: revisionId, status: "draft" })),
    updateDraftRevision: vi.fn(() => ({ revision_id: revisionId, status: "draft" })),
    listRevisionHistory: vi.fn(() => []),
    listPublicationHistory: vi.fn(() => []),
    validateDraft: vi.fn(() => ({ valid: true, errors: [], warnings: [] })),
    compilePreview: vi.fn(() => ({ valid: true, snapshot_checksum: "1234abcd", snapshot_byte_size: 100 })),
    prepareDraftPublication: vi.fn(() => ({ local_preflight_passed: true, blockers: [] })),
    publishDraftRevision: vi.fn(() => ({ success: true, publication_id: "21111111-1111-4111-8111-000000000001" })),
    prepareRevisionRollback: vi.fn(() => ({ local_preflight_passed: true, blockers: [] })),
    rollbackPublishedRevision: vi.fn(() => ({ success: true, publication_id: "21111111-1111-4111-8111-000000000002" })),
    compareDraftAgainstActive: vi.fn(() => ({ exact: true, differences: [], warnings: [] })),
  };
}

function request(method, body = undefined, headers = {}) {
  return new Request("https://example.test/app/bundle-admin", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
  });
}

async function responseBody(response) {
  return { status: response.status, cacheControl: response.headers.get("Cache-Control"), body: await response.json() };
}

describe("Bundle Admin authenticated route handlers", () => {
  it("authenticates and returns the bundle list", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.listBundles({ request: request("GET"), params: {} }));

    expect(result).toEqual({ status: 200, cacheControl: "no-store", body: { ok: true, data: [] } });
    expect(service.listBundles).toHaveBeenCalledOnce();
  });

  it("creates Remix Node-compatible JSON responses while preserving the envelope", async () => {
    const result = await responseBody(createBundleAdminHttpResponse(201, { ok: true, data: { created: true } }));

    expect(result).toEqual({
      status: 201,
      cacheControl: "no-store",
      body: { ok: true, data: { created: true } },
    });
  });

  it.each([401, 403])("maps Shopify authentication failure %s to a normalized response", async (status) => {
    const { routes } = handlers({
      authenticateAdmin: async () => { throw new Response(null, { status }); },
    });
    const result = await responseBody(await routes.listBundles({ request: request("GET"), params: {} }));

    expect(result.status).toBe(status);
    expect(result.body).toMatchObject({ ok: false, error: { code: status === 403 ? "FORBIDDEN" : "UNAUTHENTICATED" } });
  });

  it("returns 400 before calling the service for invalid JSON input", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.createBundleDefinition({
      request: new Request("https://example.test/app/bundle-admin", { method: "POST", body: "not json", headers: { "content-type": "application/json" } }),
      params: {},
    }));

    expect(result).toMatchObject({ status: 400, body: { ok: false, error: { code: "INVALID_REQUEST" } } });
    expect(service.createBundleDefinition).not.toHaveBeenCalled();
  });

  it("passes validated creation input and the authenticated actor to the application service", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.createBundleDefinition({
      request: request("POST", {
        slug: "aces-master-kit",
        parent_binding: { product_gid: "gid://shopify/Product/1", variant_gid: "gid://shopify/ProductVariant/1" },
      }),
      params: {},
    }));

    expect(result.status).toBe(200);
    expect(service.createBundleDefinition).toHaveBeenCalledWith(expect.objectContaining({
      slug: "aces-master-kit",
      created_by: "test.myshopify.com",
    }));
  });

  it("returns an authenticated, write-free pre-built import review plan", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.reviewPrebuiltBundleImport({
      request: request("POST", {
        import_id: "11111111-1111-4111-8111-000000000001",
        source_records: [],
        mappings: [],
        pilot_scope: {},
      }),
      params: {},
    }));

    expect(result).toMatchObject({ status: 200, body: { ok: true, data: { mode: "dry_run" } } });
    expect(service.reviewPrebuiltBundleImport).toHaveBeenCalledWith(expect.objectContaining({
      import_id: "11111111-1111-4111-8111-000000000001",
      source_records: [],
      mappings: [],
    }));
  });

  it("rejects malformed pre-built import review input before invoking the service", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.reviewPrebuiltBundleImport({
      request: request("POST", { import_id: "x", source_records: {}, mappings: [] }),
      params: {},
    }));
    expect(result).toMatchObject({ status: 400, body: { error: { code: "INVALID_REQUEST" } } });
    expect(service.reviewPrebuiltBundleImport).not.toHaveBeenCalled();
  });

  it("accepts a canonical import package without requiring duplicate split fields", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.reviewPrebuiltBundleImport({
      request: request("POST", { import_package: { schema_version: "prebuilt_bundle_import_package.v1" } }),
      params: {},
    }));
    expect(result).toMatchObject({ status: 200, body: { ok: true } });
    expect(service.reviewPrebuiltBundleImport).toHaveBeenCalledWith({
      import_package: { schema_version: "prebuilt_bundle_import_package.v1" },
    });
  });

  it("passes validated raw source review input without exposing it to execution", async () => {
    const { routes, service } = handlers();
    const body = {
      import_id: "11111111-1111-4111-8111-000000000001",
      raw_source_export: [{ id: "bundle-1" }],
      source_mapping_profile: { schema_version: "prebuilt_bundle_source_mapping.v1" },
      mappings: [],
      pilot_scope: {},
    };
    const result = await responseBody(await routes.reviewPrebuiltBundleImport({
      request: request("POST", body),
      params: {},
    }));

    expect(result).toMatchObject({ status: 200, body: { ok: true } });
    expect(service.reviewPrebuiltBundleImport).toHaveBeenCalledWith(body);
  });

  it("rejects incomplete raw source review input before invoking the service", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.reviewPrebuiltBundleImport({
      request: request("POST", {
        import_id: "11111111-1111-4111-8111-000000000001",
        raw_source_export: [],
        mappings: [],
        pilot_scope: {},
      }),
      params: {},
    }));

    expect(result).toMatchObject({ status: 400, body: { error: { code: "INVALID_REQUEST" } } });
    expect(service.reviewPrebuiltBundleImport).not.toHaveBeenCalled();
  });

  it("passes only validated package execution input to the guarded service command", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.executePrebuiltBundleImport({
      request: request("POST", {
        import_package: { schema_version: "prebuilt_bundle_import_package.v1" },
        confirmation_token: "1234abcd",
        confirmation: "IMPORT:id:1234abcd",
      }),
      params: {},
    }));

    expect(result).toMatchObject({ status: 200, body: { ok: true, data: { completed: 1 } } });
    expect(service.executePrebuiltBundleImport).toHaveBeenCalledWith({
      import_package: { schema_version: "prebuilt_bundle_import_package.v1" },
      confirmation_token: "1234abcd",
      confirmation: "IMPORT:id:1234abcd",
    });
  });

  it("updates Definition basic fields through the existing detail resource", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.updateBundleDefinition({
      request: request("PUT", {
        slug: "aces-master-kit-updated",
        parent_binding: { product_gid: "gid://shopify/Product/1", variant_gid: "gid://shopify/ProductVariant/1" },
      }),
      params: { bundleDefinitionId: definitionId },
    }));

    expect(result).toMatchObject({ status: 200, body: { ok: true } });
    expect(service.updateBundleDefinition).toHaveBeenCalledWith(expect.objectContaining({
      bundle_definition_id: definitionId,
      updated_by: "test.myshopify.com",
    }));
  });

  it("maps application not-found and conflict errors", async () => {
    const notFoundService = serviceStub();
    notFoundService.getBundleDetail.mockImplementation(() => {
      throw new BundleAdminApplicationError("NOT_FOUND", "bundle was not found");
    });
    const notFound = handlers({ service: notFoundService }).routes;
    const notFoundResult = await responseBody(await notFound.getBundleDetail({
      request: request("GET"), params: { bundleDefinitionId: definitionId },
    }));
    expect(notFoundResult).toMatchObject({ status: 404, body: { error: { code: "NOT_FOUND" } } });

    const conflictService = serviceStub();
    conflictService.cloneActiveRevisionToDraft.mockImplementation(() => {
      throw new BundleAdminApplicationError("IMMUTABLE_REVISION", "revision is immutable");
    });
    const conflict = handlers({ service: conflictService }).routes;
    const conflictResult = await responseBody(await conflict.cloneActiveRevision({
      request: request("POST", {}), params: { bundleDefinitionId: definitionId },
    }));
    expect(conflictResult).toMatchObject({ status: 409, body: { error: { code: "IMMUTABLE_REVISION" } } });
  });

  it("maps draft validation failures to 422", async () => {
    const service = serviceStub();
    service.updateDraftRevision.mockImplementation(() => {
      throw new BundleAdminApplicationError("VALIDATION_FAILED", "configuration is invalid");
    });
    const { routes } = handlers({ service });
    const result = await responseBody(await routes.updateDraftRevision({
      request: request("PUT", { configuration: {} }),
      params: { revisionId },
    }));

    expect(result).toMatchObject({ status: 422, body: { error: { code: "VALIDATION_FAILED" } } });
  });

  it("reports unconfirmed Shopify writes without exposing an unexpected internal error", async () => {
    const service = serviceStub();
    service.updateDraftRevision.mockImplementation(() => {
      throw new BundleAdminApplicationError(
        "PERSISTENCE_FAILED",
        "Shopify did not confirm the persisted Metaobject document",
        { resource_type: "$app:aces_bundle_revision_dev", handle: revisionId, source: "read_back" },
      );
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { routes } = handlers({ service });
    const result = await responseBody(await routes.updateDraftRevision({
      request: request("PUT", { configuration: {} }),
      params: { revisionId },
    }));
    errorSpy.mockRestore();

    expect(result).toMatchObject({
      status: 500,
      body: { error: {
        code: "PERSISTENCE_FAILED",
        message: "Shopify persistence did not confirm the requested operation",
        details: { source: "read_back" },
      } },
    });
  });

  it("maps unexpected service failures to 500", async () => {
    const service = serviceStub();
    service.listBundles.mockImplementation(() => { throw new Error("unexpected"); });
    const { routes } = handlers({ service });
    const result = await responseBody(await routes.listBundles({ request: request("GET"), params: {} }));

    expect(result).toMatchObject({ status: 500, body: { error: { code: "INTERNAL_ERROR" } } });
  });

  it("returns compile preview DTO through the authenticated handler", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.compilePreview({
      request: request("POST", {}), params: { revisionId },
    }));

    expect(result).toMatchObject({ status: 200, body: { ok: true, data: { snapshot_checksum: "1234abcd" } } });
    expect(service.compilePreview).toHaveBeenCalledWith({ revision_id: revisionId });
  });

  it("returns the read-only publication audit through the authenticated handler", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.listPublicationHistory({
      request: request("GET"), params: { bundleDefinitionId: definitionId },
    }));

    expect(result).toEqual({ status: 200, cacheControl: "no-store", body: { ok: true, data: [] } });
    expect(service.listPublicationHistory).toHaveBeenCalledWith({ bundle_definition_id: definitionId });
  });

  it("returns the read-only publication readiness DTO through the authenticated handler", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.prepareDraftPublication({
      request: request("POST", {}), params: { revisionId },
    }));

    expect(result).toMatchObject({ status: 200, body: { ok: true, data: { local_preflight_passed: true } } });
    expect(service.prepareDraftPublication).toHaveBeenCalledWith({ revision_id: revisionId });
  });

  it("passes only the stable publication ID and exact confirmation to the guarded publish command", async () => {
    const { routes, service } = handlers();
    const result = await responseBody(await routes.publishDraftRevision({
      request: request("POST", {
        publication_id: "21111111-1111-4111-8111-000000000001",
        confirmation: `PUBLISH:${definitionId}:${revisionId}`,
      }),
      params: { revisionId },
    }));

    expect(result).toMatchObject({ status: 200, body: { ok: true, data: { success: true } } });
    expect(service.publishDraftRevision).toHaveBeenCalledWith({
      revision_id: revisionId,
      publication_id: "21111111-1111-4111-8111-000000000001",
      confirmation: `PUBLISH:${definitionId}:${revisionId}`,
    });
  });

  it("rejects a disabled publish capability without invoking a fallback write", async () => {
    const service = serviceStub();
    service.publishDraftRevision.mockImplementation(() => {
      throw new BundleAdminApplicationError("UNSUPPORTED_CAPABILITY", "publication command is disabled");
    });
    const { routes } = handlers({ service });
    const result = await responseBody(await routes.publishDraftRevision({
      request: request("POST", {
        publication_id: "21111111-1111-4111-8111-000000000001",
        confirmation: `PUBLISH:${definitionId}:${revisionId}`,
      }),
      params: { revisionId },
    }));

    expect(result).toMatchObject({ status: 422, body: { error: { code: "UNSUPPORTED_CAPABILITY" } } });
  });

  it("passes rollback readiness and exact rollback confirmation through the authenticated handlers", async () => {
    const { routes, service } = handlers();
    const readiness = await responseBody(await routes.prepareRevisionRollback({
      request: request("POST", {}), params: { revisionId },
    }));
    const rollback = await responseBody(await routes.rollbackPublishedRevision({
      request: request("POST", {
        publication_id: "21111111-1111-4111-8111-000000000002",
        confirmation: `ROLLBACK:${definitionId}:${revisionId}`,
      }),
      params: { revisionId },
    }));

    expect(readiness).toMatchObject({ status: 200, body: { ok: true, data: { local_preflight_passed: true } } });
    expect(service.prepareRevisionRollback).toHaveBeenCalledWith({ revision_id: revisionId });
    expect(rollback).toMatchObject({ status: 200, body: { ok: true, data: { success: true } } });
    expect(service.rollbackPublishedRevision).toHaveBeenCalledWith({
      revision_id: revisionId,
      publication_id: "21111111-1111-4111-8111-000000000002",
      confirmation: `ROLLBACK:${definitionId}:${revisionId}`,
    });
  });
});
