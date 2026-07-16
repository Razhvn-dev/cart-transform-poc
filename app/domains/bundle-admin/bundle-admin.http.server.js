import { json } from "@remix-run/node";
import { BundleAdminApplicationError, toApplicationErrorDto } from "./bundle-admin.service.js";

export function createBundleAdminRouteHandlers({ authenticateAdmin, service, getService = () => service }) {
  if (typeof authenticateAdmin !== "function") throw new TypeError("authenticateAdmin must be a function");
  if (typeof getService !== "function") throw new TypeError("getService must be a function");

  return {
    listBundles: (args) => execute(args, { method: "GET", authenticateAdmin, getService, invoke: (currentService) => currentService.listBundles() }),
    getBundleDetail: (args) => execute(args, {
      method: "GET",
      authenticateAdmin,
      getService,
      input: ({ params }) => ({ bundle_definition_id: requiredParam(params, "bundleDefinitionId") }),
      invoke: (currentService, input) => currentService.getBundleDetail(input),
    }),
    listPublicationHistory: (args) => execute(args, {
      method: "GET",
      authenticateAdmin,
      getService,
      input: ({ params }) => ({ bundle_definition_id: requiredParam(params, "bundleDefinitionId") }),
      invoke: (currentService, input) => currentService.listPublicationHistory(input),
    }),
    createBundleDefinition: (args) => execute(args, {
      method: "POST",
      authenticateAdmin,
      getService,
      input: async ({ request, session }) => {
        const body = await jsonBody(request);
        return {
          bundle_definition_id: optionalString(body.bundle_definition_id),
          slug: requiredString(body.slug, "slug"),
          parent_binding: requiredObject(body.parent_binding, "parent_binding"),
          created_by: actor(session),
        };
      },
      invoke: (currentService, input) => currentService.createBundleDefinition(input),
    }),
    updateBundleDefinition: (args) => execute(args, {
      method: "PUT",
      authenticateAdmin,
      getService,
      input: async ({ request, params, session }) => {
        const body = await jsonBody(request);
        return {
          bundle_definition_id: requiredParam(params, "bundleDefinitionId"),
          slug: requiredString(body.slug, "slug"),
          parent_binding: requiredObject(body.parent_binding, "parent_binding"),
          updated_by: actor(session),
        };
      },
      invoke: (currentService, input) => currentService.updateBundleDefinition(input),
    }),
    createDraftRevision: (args) => execute(args, {
      method: "POST",
      authenticateAdmin,
      getService,
      input: async ({ request, params, session }) => {
        const body = await jsonBody(request);
        return {
          bundle_definition_id: requiredParam(params, "bundleDefinitionId"),
          revision_id: optionalString(body.revision_id),
          configuration: requiredObject(body.configuration, "configuration"),
          created_by: actor(session),
        };
      },
      invoke: (currentService, input) => currentService.createDraftRevision(input),
    }),
    cloneActiveRevision: (args) => execute(args, {
      method: "POST",
      authenticateAdmin,
      getService,
      input: async ({ request, params, session }) => {
        const body = await jsonBody(request);
        return {
          bundle_definition_id: requiredParam(params, "bundleDefinitionId"),
          revision_id: optionalString(body.revision_id),
          created_by: actor(session),
        };
      },
      invoke: (currentService, input) => currentService.cloneActiveRevisionToDraft(input),
    }),
    listRevisionHistory: (args) => execute(args, {
      method: "GET",
      authenticateAdmin,
      getService,
      input: ({ params }) => ({ bundle_definition_id: requiredParam(params, "bundleDefinitionId") }),
      invoke: (currentService, input) => currentService.listRevisionHistory(input),
    }),
    updateDraftRevision: (args) => execute(args, {
      method: "PUT",
      authenticateAdmin,
      getService,
      input: async ({ request, params, session }) => {
        const body = await jsonBody(request);
        return {
          revision_id: requiredParam(params, "revisionId"),
          configuration: requiredObject(body.configuration, "configuration"),
          updated_by: actor(session),
        };
      },
      invoke: (currentService, input) => currentService.updateDraftRevision(input),
    }),
    validateDraft: (args) => execute(args, {
      method: "POST",
      authenticateAdmin,
      getService,
      input: async ({ request, params }) => {
        await jsonBody(request);
        return { revision_id: requiredParam(params, "revisionId") };
      },
      invoke: (currentService, input) => currentService.validateDraft(input),
    }),
    compilePreview: (args) => execute(args, {
      method: "POST",
      authenticateAdmin,
      getService,
      input: async ({ request, params }) => {
        await jsonBody(request);
        return { revision_id: requiredParam(params, "revisionId") };
      },
      invoke: (currentService, input) => currentService.compilePreview(input),
    }),
    prepareDraftPublication: (args) => execute(args, {
      method: "POST",
      authenticateAdmin,
      getService,
      input: async ({ request, params }) => {
        await jsonBody(request);
        return { revision_id: requiredParam(params, "revisionId") };
      },
      invoke: (currentService, input) => currentService.prepareDraftPublication(input),
    }),
    publishDraftRevision: (args) => execute(args, {
      method: "POST",
      authenticateAdmin,
      getService,
      input: async ({ request, params }) => {
        const body = await jsonBody(request);
        return {
          revision_id: requiredParam(params, "revisionId"),
          publication_id: requiredString(body.publication_id, "publication_id"),
          confirmation: requiredString(body.confirmation, "confirmation"),
        };
      },
      invoke: (currentService, input) => currentService.publishDraftRevision(input),
    }),
    prepareRevisionRollback: (args) => execute(args, {
      method: "POST",
      authenticateAdmin,
      getService,
      input: ({ params }) => ({ revision_id: requiredParam(params, "revisionId") }),
      invoke: (currentService, input) => currentService.prepareRevisionRollback(input),
    }),
    rollbackPublishedRevision: (args) => execute(args, {
      method: "POST",
      authenticateAdmin,
      getService,
      input: async ({ request, params }) => {
        const body = await jsonBody(request);
        return {
          revision_id: requiredParam(params, "revisionId"),
          publication_id: requiredString(body.publication_id, "publication_id"),
          confirmation: requiredString(body.confirmation, "confirmation"),
        };
      },
      invoke: (currentService, input) => currentService.rollbackPublishedRevision(input),
    }),
    compareDraftWithActive: (args) => execute(args, {
      method: "POST",
      authenticateAdmin,
      getService,
      input: async ({ request, params }) => {
        await jsonBody(request);
        return { revision_id: requiredParam(params, "revisionId") };
      },
      invoke: (currentService, input) => currentService.compareDraftAgainstActive(input),
    }),
  };
}

export function createBundleAdminHttpResponse(status, payload) {
  return json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

async function execute(args, { method, authenticateAdmin, getService, input = () => ({}), invoke }) {
  if (args.request.method !== method) {
    return failure(405, "METHOD_NOT_ALLOWED", `expected ${method} request`);
  }

  let authentication;
  try {
    authentication = await authenticateAdmin(args.request);
  } catch (error) {
    return authenticationFailure(error);
  }

  try {
    const currentService = await getService(authentication);
    const parsedInput = await input({ ...args, session: authentication?.session });
    return success(await invoke(currentService, parsedInput));
  } catch (error) {
    return applicationFailure(error);
  }
}

async function jsonBody(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new BundleAdminRequestError("JSON request body is required");
  }
  try {
    const body = await request.json();
    if (!isPlainObject(body)) throw new BundleAdminRequestError("request body must be an object");
    return body;
  } catch (error) {
    if (error instanceof BundleAdminRequestError) throw error;
    throw new BundleAdminRequestError("request body contains invalid JSON");
  }
}

function requiredParam(params, name) {
  return requiredString(params?.[name], name);
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BundleAdminRequestError(`${name} is required`);
  }
  return value;
}

function optionalString(value) {
  if (value === undefined) return undefined;
  return requiredString(value, "optional identifier");
}

function requiredObject(value, name) {
  if (!isPlainObject(value)) throw new BundleAdminRequestError(`${name} must be an object`);
  return value;
}

function actor(session) {
  return typeof session?.shop === "string" && session.shop !== "" ? session.shop : "authenticated-admin";
}

function success(data) {
  return createBundleAdminHttpResponse(200, { ok: true, data });
}

function failure(status, code, message, details = null) {
  return createBundleAdminHttpResponse(status, { ok: false, error: { code, message, details } });
}

function authenticationFailure(error) {
  const status = error instanceof Response && (error.status === 401 || error.status === 403) ? error.status : 401;
  const code = status === 403 ? "FORBIDDEN" : "UNAUTHENTICATED";
  return failure(status, code, "Shopify embedded app authentication failed");
}

function applicationFailure(error) {
  if (error instanceof BundleAdminRequestError) return failure(400, "INVALID_REQUEST", error.message);
  if (error instanceof BundleAdminApplicationError) return applicationFailureDto(toApplicationErrorDto(error));
  return failure(500, "INTERNAL_ERROR", "unexpected Bundle Admin server error");
}

function applicationFailureDto(dto) {
  if (dto.code === "NOT_FOUND") return failure(404, dto.code, dto.message, dto.details);
  if (dto.code === "CONFLICT" || dto.code === "IMMUTABLE_REVISION") return failure(409, dto.code, dto.message, dto.details);
  if (["VALIDATION_FAILED", "COMPILATION_FAILED", "UNSUPPORTED_CAPABILITY"].includes(dto.code)) {
    return failure(422, dto.code, dto.message, dto.details);
  }
  if (dto.code === "PERSISTENCE_FAILED") {
    console.error("Bundle Admin persistence failure", {
      code: dto.code,
      message: dto.message,
      details: dto.details ?? null,
    });
    return failure(500, dto.code, "Shopify persistence did not confirm the draft save", dto.details);
  }
  return failure(500, "INTERNAL_ERROR", "unexpected Bundle Admin server error");
}

class BundleAdminRequestError extends Error {}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
