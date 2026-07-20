export const DEV_PERSISTENCE_RECONCILIATION_TARGET = Object.freeze({
  appConfig: "shopify.app.dev.toml",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
  productId: "gid://shopify/Product/10600519598358",
  handles: Object.freeze({
    bundleDefinition: "44440000-0000-4000-8000-000000000001",
    bundleRevision: "44440000-0000-4000-8000-000000000002",
    publicationRecord: "44440000-0000-4000-8000-000000000003",
  }),
});

export function buildDevPersistenceReconciliationQuery(target = DEV_PERSISTENCE_RECONCILIATION_TARGET) {
  return `#graphql
    query BundleAdminDevPersistenceReconciliation {
      shop { myshopifyDomain }
      currentAppInstallation { id accessScopes { handle } }
      definition: metaobjectByHandle(handle: { type: "$app:aces_bundle_definition_dev", handle: "${target.handles.bundleDefinition}" }) {
        id type handle fields { key value jsonValue }
      }
      revision: metaobjectByHandle(handle: { type: "$app:aces_bundle_revision_dev", handle: "${target.handles.bundleRevision}" }) {
        id type handle fields { key value jsonValue }
      }
      publication: metaobjectByHandle(handle: { type: "$app:aces_bundle_publication_record_dev", handle: "${target.handles.publicationRecord}" }) {
        id type handle fields { key value jsonValue }
      }
      product(id: "${target.productId}") {
        snapshot: metafield(namespace: "aces_dev", key: "bundle_runtime_snapshot_v1") { type value jsonValue compareDigest }
        activeRevision: metafield(namespace: "aces_dev", key: "active_revision_id_v1") { type value compareDigest }
        runtimeTest: metafield(namespace: "aces_dev", key: "bundle_runtime_snapshot_test") { type value jsonValue compareDigest }
      }
    }
  `;
}

export function assertReadOnlyGraphql(query) {
  if (typeof query !== "string" || !/^\s*(?:#graphql\s*)?query\b/i.test(query)) {
    throw new Error("persistence reconciliation must use a GraphQL query");
  }
  if (/\bmutation\b/i.test(query)) {
    throw new Error("persistence reconciliation must not contain a mutation");
  }
  return query;
}

export function summarizeDevPersistenceReconciliation(payload) {
  const data = payload?.data ?? payload;
  if (!data || typeof data !== "object") throw new Error("Shopify reconciliation returned no data");
  const product = data.product ?? {};
  const definition = documentFromMetaobject(data.definition);
  const revision = documentFromMetaobject(data.revision);
  const publication = documentFromMetaobject(data.publication);
  const snapshot = product.snapshot?.jsonValue ?? null;
  const activeRevision = product.activeRevision ?? null;
  const definitionActiveRevisionId = definition?.active_revision_id ?? null;
  const productActiveRevisionId = activeRevision?.value ?? null;

  return {
    store: data.shop?.myshopifyDomain ?? null,
    app_installation_id: data.currentAppInstallation?.id ?? null,
    scopes: [...(data.currentAppInstallation?.accessScopes ?? [])]
      .map((scope) => scope?.handle)
      .filter((scope) => typeof scope === "string")
      .sort(),
    records: {
      bundle_definition: summarizeMetaobject(data.definition, definition, ["bundle_definition_id", "active_revision_id", "updated_at"]),
      bundle_revision: summarizeMetaobject(data.revision, revision, ["revision_id", "bundle_definition_id", "revision_number", "status", "updated_at"]),
      publication_record: summarizeMetaobject(data.publication, publication, ["publication_id", "bundle_definition_id", "revision_id", "state", "updated_at"]),
    },
    runtime_snapshot: snapshot == null ? null : {
      snapshot_schema: snapshot.snapshot_schema ?? null,
      configuration_version: snapshot.configuration_version ?? null,
      checksum: snapshot.checksum ?? null,
      compare_digest: product.snapshot?.compareDigest ?? null,
    },
    active_revision: activeRevision == null ? null : {
      value: productActiveRevisionId,
      compare_digest: activeRevision.compareDigest ?? null,
    },
    pointer_drift: definition == null ? null : {
      definition_active_revision_id: definitionActiveRevisionId,
      product_active_revision_id: productActiveRevisionId,
      detected: definitionActiveRevisionId !== productActiveRevisionId,
    },
    runtime_snapshot_test_compare_digest: product.runtimeTest?.compareDigest ?? null,
  };
}

function summarizeMetaobject(metaobject, document, fields) {
  return metaobject ? {
    id: metaobject.id ?? null,
    type: metaobject.type ?? null,
    handle: metaobject.handle ?? null,
    document: pickDocumentFields(document, fields),
  } : null;
}

function documentFromMetaobject(metaobject) {
  const field = metaobject?.fields?.find((candidate) => candidate?.key === "document");
  const value = field?.jsonValue ?? field?.value ?? null;
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pickDocumentFields(document, fields) {
  if (!document || typeof document !== "object") return null;
  return Object.fromEntries(fields.map((field) => [field, document[field] ?? null]));
}
