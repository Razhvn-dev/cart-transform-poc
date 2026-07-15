import {
  BundlePersistenceError,
  assertActiveRevisionCasInput,
  assertSnapshotCasInput,
  normalizeBundlePersistenceError,
} from "./bundle-persistence.adapter.js";

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
    async writeRuntimeSnapshot(input) {
      assertSnapshotCasInput(input);
      const definition = await adapter.readBundleDefinition(input.bundle_definition_id);
      const current = await readProductMetafield(
        graphql,
        definition.parent_binding.product_gid,
        bindings.metafields.runtimeSnapshotKey,
        bindings,
      );
      if (current.document?.checksum !== input.expected_previous_snapshot_checksum) {
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

function createGraphqlExecutor(execute) {
  return async (query, variables = {}) => {
    try {
      const response = await execute(query, { variables });
      const payload = typeof response?.json === "function" ? await response.json() : response;
      if (payload?.errors?.length) throw new BundlePersistenceError("WRITE_FAILED", payload.errors[0].message);
      if (!payload?.data) throw new BundlePersistenceError("READ_BACK_FAILED", "Shopify Admin GraphQL returned no data");
      return payload.data;
    } catch (error) {
      throw normalizeBundlePersistenceError(error, "WRITE_FAILED");
    }
  };
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
  const data = await graphql(METAOBJECT_LIST_QUERY, { type, first: 250 });
  return (data.metaobjects?.nodes ?? []).map((node) =>
    documentFromFields(node.fields, bindings.documentFieldKey, "Metaobject document"),
  );
}

async function upsertDocument(graphql, type, handle, document, bindings) {
  const data = await graphql(METAOBJECT_BY_HANDLE_QUERY, { type, handle });
  if (data.metaobjectByHandle) {
    const updated = await graphql(METAOBJECT_UPDATE_MUTATION, {
      id: data.metaobjectByHandle.id,
      metaobject: { fields: [documentField(bindings, document)] },
    });
    assertUserErrors(updated.metaobjectUpdate?.userErrors, "WRITE_FAILED");
    return documentFromFields(updated.metaobjectUpdate?.metaobject?.fields, bindings.documentFieldKey, "Metaobject document");
  }
  return createDocument(graphql, type, handle, document, bindings);
}

async function createDocument(graphql, type, handle, document, bindings) {
  const data = await graphql(METAOBJECT_CREATE_MUTATION, {
    metaobject: { type, handle, fields: [documentField(bindings, document)] },
  });
  assertUserErrors(data.metaobjectCreate?.userErrors, "WRITE_FAILED");
  return documentFromFields(data.metaobjectCreate?.metaobject?.fields, bindings.documentFieldKey, "Metaobject document");
}

async function readProductMetafield(graphql, productId, key, bindings) {
  const data = await graphql(PRODUCT_METAFIELD_QUERY, { productId, namespace: bindings.metafields.namespace, key });
  const metafield = data.product?.metafield ?? null;
  return {
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
  query BundlePersistenceMetaobjects($type: String!, $first: Int!) {
    metaobjects(type: $type, first: $first) {
      nodes { fields { key value jsonValue } }
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

const METAFIELDS_SET_MUTATION = `#graphql
  mutation BundlePersistenceMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { type value jsonValue compareDigest }
      userErrors { field message code }
    }
  }`;
