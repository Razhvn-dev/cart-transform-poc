import { createHash } from "node:crypto";
import {
  BundlePersistenceError,
  assertActiveRevisionCasInput,
  assertSnapshotCasInput,
  normalizeBundlePersistenceError,
} from "./bundle-persistence.adapter.js";
import { validatePrebuiltBundleExpandProjection } from "./prebuilt-bundle-expand-projection.js";

export const DEV_SHOPIFY_APP_CLIENT_ID = "d25c62f609855572f3f266765d105ebb";

export const DEV_SHOPIFY_PERSISTENCE_BINDINGS = Object.freeze({
  metaobjectTypes: Object.freeze({
    bundleDefinition: "$app:aces_bundle_definition_dev",
    bundleRevision: "$app:aces_bundle_revision_dev",
    publicationRecord: "$app:aces_bundle_publication_record_dev",
  }),
  documentFieldKey: "document",
  metafields: Object.freeze({
    namespace: "aces_dev",
    runtimeSnapshotKey: "bundle_runtime_snapshot_v1",
    prebuiltExpandProjectionKey: "prebuilt_bundle_expand_projection_v1",
    prebuiltImportLedgerKeyPrefix: "prebuilt_import_ledger_v1_",
    activeRevisionKey: "active_revision_id_v1",
  }),
});

// This adapter is intentionally async. The pure Phase 4.2 orchestrator remains local-only.
export function createDevShopifyPersistenceAdapter({ execute, appClientId, bindings = DEV_SHOPIFY_PERSISTENCE_BINDINGS }) {
  assertDevTarget({ appClientId, bindings });
  if (typeof execute !== "function") {
    throw new BundlePersistenceError("UNSUPPORTED_CAPABILITY", "a Shopify Admin GraphQL executor is required");
  }

  const graphql = createGraphqlExecutor(execute);
  const adapter = {
    capabilities: Object.freeze({
      active_revision_cas: true,
      snapshot_checksum_cas: true,
      metaobject_compare_and_set: false,
      snapshot_delete_with_cas: false,
      prebuilt_expand_projection_checksum_cas: true,
      prebuilt_import_ledger_cas: true,
    }),
    async readBundleDefinition(bundleDefinitionId) {
      return readRequiredDocument(graphql, bindings.metaobjectTypes.bundleDefinition, bundleDefinitionId, "BundleDefinition", bindings);
    },
    async listBundleDefinitions() {
      return listDocuments(graphql, bindings.metaobjectTypes.bundleDefinition, bindings);
    },
    async writeBundleDefinition({ definition }) {
      return upsertDocument(graphql, bindings.metaobjectTypes.bundleDefinition, definition.bundle_definition_id, definition, bindings);
    },
    async readRevision(revisionId) {
      return readRequiredDocument(graphql, bindings.metaobjectTypes.bundleRevision, revisionId, "BundleRevision", bindings);
    },
    async listRevisionsByDefinition(bundleDefinitionId) {
      const revisions = await listDocuments(graphql, bindings.metaobjectTypes.bundleRevision, bindings);
      return revisions.filter((revision) => revision.bundle_definition_id === bundleDefinitionId);
    },
    async writeRevision({ revision }) {
      return upsertDocument(graphql, bindings.metaobjectTypes.bundleRevision, revision.revision_id, revision, bindings);
    },
    async readRuntimeSnapshot(bundleDefinitionId) {
      const definition = await adapter.readBundleDefinition(bundleDefinitionId);
      return (await readProductMetafield(graphql, definition.parent_binding.product_gid, bindings.metafields.runtimeSnapshotKey, bindings))
        .document;
    },
    async readActiveRevisionId(bundleDefinitionId) {
      const definition = await adapter.readBundleDefinition(bundleDefinitionId);
      return (await readProductMetafield(
        graphql,
        definition.parent_binding.product_gid,
        bindings.metafields.activeRevisionKey,
        bindings,
      )).document;
    },
    async readPrebuiltExpandProjection(bundleDefinitionId) {
      const definition = await adapter.readBundleDefinition(bundleDefinitionId);
      return (await readProductMetafield(
        graphql,
        definition.parent_binding.product_gid,
        bindings.metafields.prebuiltExpandProjectionKey,
        bindings,
      )).document;
    },
    async writePrebuiltExpandProjection(input) {
      assertProjectionCasInput(input);
      const errors = validatePrebuiltBundleExpandProjection(input.projection);
      if (errors.length > 0) {
        throw new BundlePersistenceError("WRITE_FAILED", `invalid pre-built expand projection: ${errors.join("; ")}`);
      }
      if (input.projection.checksum !== input.target_projection_checksum) {
        throw new BundlePersistenceError("CHECKSUM_MISMATCH", "target projection checksum does not match");
      }
      const definition = await adapter.readBundleDefinition(input.bundle_definition_id);
      if (input.projection.parent.product_gid !== definition.parent_binding.product_gid) {
        throw new BundlePersistenceError("WRITE_FAILED", "projection parent Product does not match BundleDefinition");
      }
      const current = await readProductMetafield(
        graphql,
        definition.parent_binding.product_gid,
        bindings.metafields.prebuiltExpandProjectionKey,
        bindings,
      );
      if ((current.document?.checksum ?? null) !== input.expected_previous_projection_checksum) {
        throw new BundlePersistenceError("CHECKSUM_MISMATCH", "previous projection checksum does not match");
      }
      const persisted = await setProductMetafield(graphql, {
        ownerId: definition.parent_binding.product_gid,
        key: bindings.metafields.prebuiltExpandProjectionKey,
        type: "json",
        value: JSON.stringify(input.projection),
        compareDigest: current.compareDigest,
      }, bindings);
      const projection = parseJsonDocument(persisted.jsonValue ?? persisted.value, "Pre-built expand projection");
      if (projection?.checksum !== input.target_projection_checksum
        || validatePrebuiltBundleExpandProjection(projection).length > 0) {
        throw new BundlePersistenceError("READ_BACK_FAILED", "projection write did not return the validated target checksum");
      }
      return projection;
    },
    async restorePreviousPrebuiltExpandProjection(input) {
      assertProjectionCasInput(input);
      if (input.previous_projection === null) {
        throw new BundlePersistenceError(
          "UNSUPPORTED_CAPABILITY",
          "Shopify does not provide compare-and-set deletion for product metafields",
        );
      }
      const definition = await adapter.readBundleDefinition(input.bundle_definition_id);
      if (input.previous_projection.parent.product_gid !== definition.parent_binding.product_gid) {
        throw new BundlePersistenceError("WRITE_FAILED", "previous projection parent Product does not match BundleDefinition");
      }
      const current = await readProductMetafield(
        graphql,
        definition.parent_binding.product_gid,
        bindings.metafields.prebuiltExpandProjectionKey,
        bindings,
      );
      if (current.document?.checksum !== input.target_projection_checksum) {
        throw new BundlePersistenceError("CHECKSUM_MISMATCH", "target projection checksum does not match persisted value");
      }
      const previousErrors = validatePrebuiltBundleExpandProjection(input.previous_projection);
      if (previousErrors.length > 0) {
        throw new BundlePersistenceError("WRITE_FAILED", `invalid previous projection: ${previousErrors.join("; ")}`);
      }
      const persisted = await setProductMetafield(graphql, {
        ownerId: definition.parent_binding.product_gid,
        key: bindings.metafields.prebuiltExpandProjectionKey,
        type: "json",
        value: JSON.stringify(input.previous_projection),
        compareDigest: current.compareDigest,
      }, bindings);
      const restored = parseJsonDocument(persisted.jsonValue ?? persisted.value, "Pre-built expand projection");
      if (restored?.checksum !== input.expected_previous_projection_checksum
        || validatePrebuiltBundleExpandProjection(restored).length > 0) {
        throw new BundlePersistenceError("READ_BACK_FAILED", "projection restore did not return the validated previous checksum");
      }
      return restored;
    },
    async writeRuntimeSnapshot(input) {
      assertSnapshotCasInput(input);
      const definition = await adapter.readBundleDefinition(input.bundle_definition_id);
      const current = await readProductMetafield(
        graphql,
        definition.parent_binding.product_gid,
        bindings.metafields.runtimeSnapshotKey,
        bindings,
      );
      const currentChecksum = current.document?.checksum ?? null;
      if (currentChecksum !== input.expected_previous_snapshot_checksum) {
        throw new BundlePersistenceError("CHECKSUM_MISMATCH", "previous Snapshot checksum does not match");
      }
      if (input.snapshot?.checksum !== input.target_snapshot_checksum) {
        throw new BundlePersistenceError("CHECKSUM_MISMATCH", "target Snapshot checksum does not match");
      }
      const persisted = await setProductMetafield(graphql, {
        ownerId: definition.parent_binding.product_gid,
        key: bindings.metafields.runtimeSnapshotKey,
        type: "json",
        value: JSON.stringify(input.snapshot),
        compareDigest: current.compareDigest,
      }, bindings);
      const snapshot = parseJsonDocument(persisted.jsonValue ?? persisted.value, "Runtime Snapshot");
      if (snapshot?.checksum !== input.target_snapshot_checksum) {
        throw new BundlePersistenceError("READ_BACK_FAILED", "Snapshot write did not return the target checksum");
      }
      return snapshot;
    },
    async compareAndSetActiveRevision(input) {
      assertActiveRevisionCasInput(input);
      const definition = await adapter.readBundleDefinition(input.bundle_definition_id);
      const current = await readProductMetafield(
        graphql,
        definition.parent_binding.product_gid,
        bindings.metafields.activeRevisionKey,
        bindings,
      );
      if (current.document !== input.expected_active_revision_id) {
        throw new BundlePersistenceError("POINTER_DRIFT", "active_revision_id does not match expected value");
      }
      await setProductMetafield(graphql, {
        ownerId: definition.parent_binding.product_gid,
        key: bindings.metafields.activeRevisionKey,
        type: "single_line_text_field",
        value: input.target_revision_id,
        compareDigest: current.compareDigest,
      }, bindings);
      return { ...definition, active_revision_id: input.target_revision_id };
    },
    async writePublicationRecord({ publication_id, record }) {
      const existing = await readOptionalDocument(graphql, bindings.metaobjectTypes.publicationRecord, publication_id, bindings);
      if (existing !== null) {
        if (stableJson(existing) === stableJson(record)) return existing;
        throw new BundlePersistenceError("RETRY_CONFLICT", "publication_id already has different content");
      }
      return createDocument(graphql, bindings.metaobjectTypes.publicationRecord, publication_id, record, bindings);
    },
    async readPublicationById(publicationId) {
      return readOptionalDocument(graphql, bindings.metaobjectTypes.publicationRecord, publicationId, bindings);
    },
    async listPublicationRecordsByDefinition(bundleDefinitionId) {
      const records = await listDocuments(graphql, bindings.metaobjectTypes.publicationRecord, bindings);
      return records.filter((record) => record?.publication_attempt?.bundle_definition_id === bundleDefinitionId);
    },
    async readPrebuiltImportLedger(sourceIdentity) {
      assertSourceIdentity(sourceIdentity);
      const current = await readShopMetafield(
        graphql,
        prebuiltImportLedgerKey(sourceIdentity, bindings),
        bindings,
      );
      if (current.document !== null && current.document.source_identity !== sourceIdentity) {
        throw new BundlePersistenceError("RETRY_CONFLICT", "pre-built import ledger key belongs to a different source identity");
      }
      return current.document;
    },
    async writePrebuiltImportLedger(record) {
      assertPrebuiltImportLedgerRecord(record);
      const key = prebuiltImportLedgerKey(record.source_identity, bindings);
      const current = await readShopMetafield(graphql, key, bindings);
      assertPrebuiltImportLedgerTransition(current.document, record);
      if (current.document !== null && stableJson(current.document) === stableJson(record)) {
        return current.document;
      }
      const persisted = await setShopMetafield(graphql, {
        ownerId: current.ownerId,
        key,
        type: "json",
        value: JSON.stringify(record),
        compareDigest: current.compareDigest,
      }, bindings);
      const document = parseJsonDocument(persisted.jsonValue ?? persisted.value, "Pre-built import ledger");
      if (stableJson(document) !== stableJson(record)) {
        throw new BundlePersistenceError("READ_BACK_FAILED", "pre-built import ledger write did not return the target record");
      }
      return document;
    },
    async restorePreviousSnapshot(input) {
      assertSnapshotCasInput(input);
      if (input.previous_snapshot === null) {
        throw new BundlePersistenceError(
          "UNSUPPORTED_CAPABILITY",
          "Shopify does not provide compare-and-set deletion for product metafields",
        );
      }
      const definition = await adapter.readBundleDefinition(input.bundle_definition_id);
      const current = await readProductMetafield(
        graphql,
        definition.parent_binding.product_gid,
        bindings.metafields.runtimeSnapshotKey,
        bindings,
      );
      if (current.document?.checksum !== input.target_snapshot_checksum) {
        throw new BundlePersistenceError("CHECKSUM_MISMATCH", "target Snapshot checksum does not match persisted value");
      }
      const persisted = await setProductMetafield(graphql, {
        ownerId: definition.parent_binding.product_gid,
        key: bindings.metafields.runtimeSnapshotKey,
        type: "json",
        value: JSON.stringify(input.previous_snapshot),
        compareDigest: current.compareDigest,
      }, bindings);
      const snapshot = parseJsonDocument(persisted.jsonValue ?? persisted.value, "Runtime Snapshot");
      if (snapshot?.checksum !== input.expected_previous_snapshot_checksum) {
        throw new BundlePersistenceError("READ_BACK_FAILED", "Snapshot restore did not return the previous checksum");
      }
      return snapshot;
    },
  };
  return Object.freeze(adapter);
}

function assertDevTarget({ appClientId, bindings }) {
  if (appClientId !== DEV_SHOPIFY_APP_CLIENT_ID) {
    throw new BundlePersistenceError("UNSUPPORTED_CAPABILITY", "Shopify persistence adapter is limited to cart-transform-poc-dev");
  }
  if (!bindings?.metaobjectTypes || !bindings?.metafields?.namespace?.startsWith("aces_dev")) {
    throw new BundlePersistenceError("UNSUPPORTED_CAPABILITY", "dev-only Shopify persistence bindings are required");
  }
}

function assertProjectionCasInput(input) {
  for (const field of ["bundle_definition_id", "target_revision_id", "target_projection_checksum", "publication_id"]) {
    if (typeof input?.[field] !== "string" || input[field].trim() === "") {
      throw new BundlePersistenceError("WRITE_FAILED", `${field} must be a non-empty string`);
    }
  }
  if (input.expected_previous_projection_checksum !== null
    && (typeof input.expected_previous_projection_checksum !== "string"
      || input.expected_previous_projection_checksum.trim() === "")) {
    throw new BundlePersistenceError("WRITE_FAILED", "expected_previous_projection_checksum must be a string or null");
  }
}

function assertSourceIdentity(sourceIdentity) {
  if (typeof sourceIdentity !== "string" || sourceIdentity.trim() === "") {
    throw new BundlePersistenceError("WRITE_FAILED", "source_identity must be a non-empty string");
  }
}

function assertPrebuiltImportLedgerRecord(record) {
  const required = [
    "schema_version", "import_id", "source_identity", "source_fingerprint",
    "target_bundle_definition_id", "target_fingerprint", "state", "created_at", "updated_at",
  ];
  for (const field of required) {
    if (typeof record?.[field] !== "string" || record[field].trim() === "") {
      throw new BundlePersistenceError("WRITE_FAILED", `pre-built import ledger ${field} must be a non-empty string`);
    }
  }
  if (record.schema_version !== "prebuilt_bundle_import_ledger.v1") {
    throw new BundlePersistenceError("WRITE_FAILED", "unsupported pre-built import ledger schema version");
  }
  if (!["pending", "completed", "failed"].includes(record.state)) {
    throw new BundlePersistenceError("WRITE_FAILED", "pre-built import ledger state is invalid");
  }
}

function assertPrebuiltImportLedgerTransition(current, target) {
  if (current === null) {
    if (target.state !== "pending") {
      throw new BundlePersistenceError("RETRY_CONFLICT", "a new pre-built import ledger must start pending");
    }
    return;
  }
  const immutableFields = [
    "schema_version", "import_id", "source_identity", "source_fingerprint",
    "target_bundle_definition_id", "target_fingerprint", "created_at",
  ];
  if (immutableFields.some((field) => current[field] !== target[field])) {
    throw new BundlePersistenceError("RETRY_CONFLICT", "pre-built import ledger target content has changed");
  }
  if (stableJson(current) === stableJson(target)) return;
  if (current.state !== "pending" || !["completed", "failed"].includes(target.state)) {
    throw new BundlePersistenceError("RETRY_CONFLICT", "pre-built import ledger terminal state is immutable");
  }
}

function prebuiltImportLedgerKey(sourceIdentity, bindings) {
  assertSourceIdentity(sourceIdentity);
  const prefix = bindings.metafields.prebuiltImportLedgerKeyPrefix;
  if (typeof prefix !== "string" || prefix.trim() === "") {
    throw new BundlePersistenceError("UNSUPPORTED_CAPABILITY", "pre-built import ledger key prefix is required");
  }
  const digest = createHash("sha256").update(sourceIdentity, "utf8").digest("hex").slice(0, 32);
  return `${prefix}${digest}`;
}

const READ_RETRY_DELAYS_MS = Object.freeze([75, 200]);

function createGraphqlExecutor(execute) {
  return async (query, variables = {}) => {
    const readOnly = isReadOnlyGraphqlOperation(query);
    const attempts = readOnly ? READ_RETRY_DELAYS_MS.length + 1 : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await execute(query, { variables });
        const payload = typeof response?.json === "function" ? await response.json() : response;
        if (payload?.errors?.length) {
          throw new BundlePersistenceError(readOnly ? "READ_BACK_FAILED" : "WRITE_FAILED", payload.errors[0].message);
        }
        if (!payload?.data) throw new BundlePersistenceError("READ_BACK_FAILED", "Shopify Admin GraphQL returned no data");
        return payload.data;
      } catch (error) {
        const canRetry = readOnly && attempt < attempts && isTransientShopifyReadError(error);
        if (canRetry) {
          await wait(READ_RETRY_DELAYS_MS[attempt - 1]);
          continue;
        }
        if (readOnly && isTransientShopifyReadError(error)) {
          throw new BundlePersistenceError(
            "READ_BACK_FAILED",
            "Shopify Admin GraphQL read failed after transient retries",
            { operation: graphqlOperationName(query), attempts: attempt, transient: true },
          );
        }
        throw normalizeBundlePersistenceError(error, readOnly ? "READ_BACK_FAILED" : "WRITE_FAILED");
      }
    }
    throw new BundlePersistenceError("READ_BACK_FAILED", "Shopify Admin GraphQL read retry loop ended unexpectedly");
  };
}

function isReadOnlyGraphqlOperation(query) {
  return /^\s*(?:#graphql\s*)?query\b/i.test(query);
}

function graphqlOperationName(query) {
  return query.match(/\bquery\s+([A-Za-z0-9_]+)/)?.[1] ?? "anonymous_query";
}

function isTransientShopifyReadError(error) {
  if (error instanceof BundlePersistenceError) return false;
  const status = Number(error?.status ?? error?.response?.status);
  if (status === 429 || status >= 500) return true;
  const codes = [error?.code, error?.cause?.code].filter(Boolean).map((value) => String(value).toUpperCase());
  if (codes.some((code) => ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_SOCKET"].includes(code))) return true;
  const message = [error?.message, error?.cause?.message].filter(Boolean).join(" ").toLowerCase();
  return ["socket hang up", "fetch failed", "network error", "timed out", "timeout"].some((token) => message.includes(token));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readRequiredDocument(graphql, type, handle, label, bindings) {
  const document = await readOptionalDocument(graphql, type, handle, bindings);
  if (document === null) throw new BundlePersistenceError("NOT_FOUND", `${label} was not found`);
  return document;
}

async function readOptionalDocument(graphql, type, handle, bindings) {
  const data = await graphql(METAOBJECT_BY_HANDLE_QUERY, { type, handle });
  const node = data.metaobjectByHandle;
  return node ? documentFromFields(node.fields, bindings.documentFieldKey, "Metaobject document") : null;
}

async function listDocuments(graphql, type, bindings) {
  const documents = [];
  let after = null;

  do {
    const data = await graphql(METAOBJECT_LIST_QUERY, { type, first: 250, after });
    documents.push(...(data.metaobjects?.nodes ?? []).map((node) =>
      documentFromFields(node.fields, bindings.documentFieldKey, "Metaobject document"),
    ));
    const pageInfo = data.metaobjects?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    if (!pageInfo.endCursor) {
      throw new BundlePersistenceError("READ_BACK_FAILED", "Shopify metaobject list returned a page without an end cursor");
    }
    after = pageInfo.endCursor;
  } while (after);

  return documents;
}

async function upsertDocument(graphql, type, handle, document, bindings) {
  const data = await graphql(METAOBJECT_BY_HANDLE_QUERY, { type, handle });
  if (data.metaobjectByHandle) {
    const updated = await graphql(METAOBJECT_UPDATE_MUTATION, {
      id: data.metaobjectByHandle.id,
      metaobject: { fields: [documentField(bindings, document)] },
    });
    assertUserErrors(updated.metaobjectUpdate?.userErrors, "WRITE_FAILED");
    const mutationDocument = documentFromFields(
      updated.metaobjectUpdate?.metaobject?.fields,
      bindings.documentFieldKey,
      "Metaobject update response",
    );
    assertDocumentMatches(document, mutationDocument, { type, handle, source: "mutation_response" });
    const readBack = await readOptionalDocument(graphql, type, handle, bindings);
    assertDocumentMatches(document, readBack, { type, handle, source: "read_back" });
    return readBack;
  }
  return createDocument(graphql, type, handle, document, bindings);
}

function assertDocumentMatches(expected, actual, { type, handle, source }) {
  if (actual !== null && stableJson(actual) === stableJson(expected)) return;
  throw new BundlePersistenceError(
    "READ_BACK_FAILED",
    "Shopify did not confirm the persisted Metaobject document",
    { resource_type: type, handle, source },
  );
}

async function createDocument(graphql, type, handle, document, bindings) {
  const data = await graphql(METAOBJECT_CREATE_MUTATION, {
    metaobject: { type, handle, fields: [documentField(bindings, document)] },
  });
  assertUserErrors(data.metaobjectCreate?.userErrors, "WRITE_FAILED");
  const mutationDocument = documentFromFields(
    data.metaobjectCreate?.metaobject?.fields,
    bindings.documentFieldKey,
    "Metaobject create response",
  );
  assertDocumentMatches(document, mutationDocument, { type, handle, source: "mutation_response" });
  const readBack = await readOptionalDocument(graphql, type, handle, bindings);
  assertDocumentMatches(document, readBack, { type, handle, source: "read_back" });
  return readBack;
}

async function readProductMetafield(graphql, productId, key, bindings) {
  const data = await graphql(PRODUCT_METAFIELD_QUERY, { productId, namespace: bindings.metafields.namespace, key });
  const metafield = data.product?.metafield ?? null;
  return {
    compareDigest: metafield?.compareDigest ?? null,
    document: metafield ? parseMetafieldDocument(metafield, key) : null,
  };
}

async function readShopMetafield(graphql, key, bindings) {
  const data = await graphql(SHOP_METAFIELD_QUERY, { namespace: bindings.metafields.namespace, key });
  if (typeof data.shop?.id !== "string" || data.shop.id === "") {
    throw new BundlePersistenceError("READ_BACK_FAILED", "Shopify Admin GraphQL returned no Shop owner ID");
  }
  const metafield = data.shop.metafield ?? null;
  return {
    ownerId: data.shop.id,
    compareDigest: metafield?.compareDigest ?? null,
    document: metafield ? parseMetafieldDocument(metafield, key) : null,
  };
}

async function setProductMetafield(graphql, metafield, bindings) {
  const data = await graphql(METAFIELDS_SET_MUTATION, {
    metafields: [{ ...metafield, namespace: bindings.metafields.namespace }],
  });
  assertUserErrors(data.metafieldsSet?.userErrors, "CHECKSUM_MISMATCH");
  const persisted = data.metafieldsSet?.metafields?.[0];
  if (!persisted) throw new BundlePersistenceError("READ_BACK_FAILED", "metafieldsSet returned no metafield");
  return persisted;
}

async function setShopMetafield(graphql, metafield, bindings) {
  return setProductMetafield(graphql, metafield, bindings);
}

function documentField(bindings, document) {
  return { key: bindings.documentFieldKey, value: JSON.stringify(document) };
}

function documentFromFields(fields, key, label) {
  const field = fields?.find((candidate) => candidate.key === key);
  if (!field) throw new BundlePersistenceError("READ_BACK_FAILED", `${label} field is missing`);
  return parseJsonDocument(field.jsonValue ?? field.value, label);
}

function parseMetafieldDocument(metafield, key) {
  if (metafield.type === "json") return parseJsonDocument(metafield.jsonValue ?? metafield.value, key);
  return metafield.value;
}

function parseJsonDocument(value, label) {
  if (value !== null && typeof value === "object") return structuredClone(value);
  try {
    return JSON.parse(value);
  } catch {
    throw new BundlePersistenceError("READ_BACK_FAILED", `${label} is not valid JSON`);
  }
}

function assertUserErrors(errors = [], fallbackCode) {
  if (errors.length === 0) return;
  const code = errors.some((error) => ["INVALID_COMPARE_DIGEST", "STALE_OBJECT"].includes(error.code))
    ? "CHECKSUM_MISMATCH"
    : fallbackCode;
  throw new BundlePersistenceError(code, errors.map((error) => error.message).join("; "));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const METAOBJECT_BY_HANDLE_QUERY = `#graphql
  query BundlePersistenceMetaobject($type: String!, $handle: String!) {
    metaobjectByHandle(handle: { type: $type, handle: $handle }) {
      id
      fields { key value jsonValue }
    }
  }`;

const METAOBJECT_CREATE_MUTATION = `#graphql
  mutation BundlePersistenceMetaobjectCreate($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject { id fields { key value jsonValue } }
      userErrors { field message code }
    }
  }`;

const METAOBJECT_LIST_QUERY = `#graphql
  query BundlePersistenceMetaobjects($type: String!, $first: Int!, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      nodes { fields { key value jsonValue } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const METAOBJECT_UPDATE_MUTATION = `#graphql
  mutation BundlePersistenceMetaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject { id fields { key value jsonValue } }
      userErrors { field message code }
    }
  }`;

const PRODUCT_METAFIELD_QUERY = `#graphql
  query BundlePersistenceProductMetafield($productId: ID!, $namespace: String!, $key: String!) {
    product(id: $productId) {
      metafield(namespace: $namespace, key: $key) {
        type
        value
        jsonValue
        compareDigest
      }
    }
  }`;

const SHOP_METAFIELD_QUERY = `#graphql
  query BundlePersistenceShopMetafield($namespace: String!, $key: String!) {
    shop {
      id
      metafield(namespace: $namespace, key: $key) {
        type
        value
        jsonValue
        compareDigest
      }
    }
  }`;

const METAFIELDS_SET_MUTATION = `#graphql
  mutation BundlePersistenceMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { type value jsonValue compareDigest }
      userErrors { field message code }
    }
  }`;
