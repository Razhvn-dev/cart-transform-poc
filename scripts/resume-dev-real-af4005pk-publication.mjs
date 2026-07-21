import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { derivePrebuiltBundleRuntimeMapping } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-runtime.mapping.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const TARGET = Object.freeze({
  appConfig: "shopify.app.dev.toml",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
  definitionId: "4b5c384b-acc6-455d-b14a-7a1e6d433ffc",
  revisionId: "e94be6f4-e08d-483b-9dcc-d80b98ee4246",
  publicationId: "4b5c384b-acc6-455d-b14a-7a1e6d433ffe",
  auditAt: "2026-07-21T06:30:00.000Z",
});

const apply = process.argv.includes("--apply");
const confirmation = `RESUME:${TARGET.definitionId}:${TARGET.revisionId}`;
if (apply && !process.argv.includes(`--confirm=${confirmation}`)) {
  throw new Error(`--apply requires --confirm=${confirmation}`);
}

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "aces-dev-real-projection-resume-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: resolve(root, "node_modules/@shopify/cli/bin/run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: TARGET,
});

try {
  const state = await readState();
  const expected = expectedProjection(state);
  assertRecoverable(state, expected);
  if (!apply) {
    console.log(JSON.stringify({ status: "recovery_ready", target: TARGET, ...summarize(state, expected), confirmation }, null, 2));
  } else {
    if (state.projection === null) {
      await writeProjection(state, expected);
    }

    if (state.definition.active_revision_id === null) {
      const activated = { ...state.definition, active_revision_id: TARGET.revisionId, updated_at: TARGET.auditAt };
      await activateDefinition(state, activated);
    }

    if (state.publication === null) {
      await writeAudit(expected);
    }

    const verified = await readState();
    assertComplete(verified, expected);
    console.log(JSON.stringify({ status: "resumed_and_verified", target: TARGET, ...summarize(verified, expected) }, null, 2));
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function readState() {
  // Keep this reconciliation to one Shopify CLI process. Parallel CLI reads
  // intermittently reset the authenticated TLS transport in this dev store.
  const payload = await execute(`#graphql
    query ReadDevRealPublicationRecovery(
      $definitionType: String!
      $definitionHandle: String!
      $revisionType: String!
      $revisionHandle: String!
      $publicationType: String!
      $publicationHandle: String!
      $productId: ID!
      $namespace: String!
    ) {
      definition: metaobjectByHandle(handle: { type: $definitionType, handle: $definitionHandle }) { id fields { key value jsonValue } }
      revision: metaobjectByHandle(handle: { type: $revisionType, handle: $revisionHandle }) { fields { key value jsonValue } }
      publication: metaobjectByHandle(handle: { type: $publicationType, handle: $publicationHandle }) { fields { key value jsonValue } }
      product(id: $productId) {
        active: metafield(namespace: $namespace, key: "active_revision_id_v1") { value compareDigest }
        snapshot: metafield(namespace: $namespace, key: "bundle_runtime_snapshot_v1") { jsonValue }
        projection: metafield(namespace: $namespace, key: "prebuilt_bundle_expand_projection_v1") { jsonValue compareDigest }
      }
    }
  `, { variables: {
    definitionType: "$app:aces_bundle_definition_dev",
    definitionHandle: TARGET.definitionId,
    revisionType: "$app:aces_bundle_revision_dev",
    revisionHandle: TARGET.revisionId,
    publicationType: "$app:aces_bundle_publication_record_dev",
    publicationHandle: TARGET.publicationId,
    productId: "gid://shopify/Product/10638462877974",
    namespace: "aces_dev",
  } });
  return {
    definitionMetaobjectId: payload.data?.definition?.id ?? null,
    definition: documentFromMetaobject(payload.data?.definition, "BundleDefinition"),
    revision: documentFromMetaobject(payload.data?.revision, "BundleRevision"),
    snapshot: payload.data?.product?.snapshot?.jsonValue ?? null,
    activeRevisionId: payload.data?.product?.active?.value ?? null,
    projection: payload.data?.product?.projection?.jsonValue ?? null,
    projectionCompareDigest: payload.data?.product?.projection?.compareDigest ?? null,
    publication: payload.data?.publication === null ? null : documentFromMetaobject(payload.data.publication, "PublicationRecord"),
  };
}

async function writeProjection(state, projection) {
  const payload = await execute(`#graphql
    mutation SetDevRealProjection($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { jsonValue }
        userErrors { field message code }
      }
    }
  `, { variables: { metafields: [{
    ownerId: "gid://shopify/Product/10638462877974",
    namespace: "aces_dev",
    key: "prebuilt_bundle_expand_projection_v1",
    type: "json",
    value: JSON.stringify(projection),
    compareDigest: state.projectionCompareDigest,
  }] } });
  const result = payload.data?.metafieldsSet;
  if (result?.userErrors?.length) throw new Error(`Projection write rejected: ${JSON.stringify(result.userErrors)}`);
  if (result?.metafields?.[0]?.jsonValue?.checksum !== projection.checksum) throw new Error("Projection mutation response mismatch");
}

async function activateDefinition(state, definition) {
  if (typeof state.definitionMetaobjectId !== "string") throw new Error("BundleDefinition Metaobject ID missing");
  const payload = await execute(`#graphql
    mutation ActivateDevRealDefinition($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { fields { key jsonValue } }
        userErrors { field message code }
      }
    }
  `, { variables: {
    id: state.definitionMetaobjectId,
    metaobject: { fields: [{ key: "document", value: JSON.stringify(definition) }] },
  } });
  const result = payload.data?.metaobjectUpdate;
  if (result?.userErrors?.length) throw new Error(`Definition activation rejected: ${JSON.stringify(result.userErrors)}`);
  const persisted = documentFromMetaobject(result?.metaobject, "activated BundleDefinition");
  if (persisted.active_revision_id !== TARGET.revisionId) throw new Error("Definition mutation response mismatch");
}

async function writeAudit(projection) {
  const payload = await execute(`#graphql
    mutation CreateDevRealPublicationAudit($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { fields { key jsonValue } }
        userErrors { field message code }
      }
    }
  `, { variables: {
    metaobject: {
      type: "$app:aces_bundle_publication_record_dev",
      handle: TARGET.publicationId,
      fields: [{ key: "document", value: JSON.stringify(auditRecord(projection)) }],
    },
  } });
  const result = payload.data?.metaobjectCreate;
  if (result?.userErrors?.length) throw new Error(`Publication audit rejected: ${JSON.stringify(result.userErrors)}`);
  const persisted = documentFromMetaobject(result?.metaobject, "PublicationRecord");
  if (persisted?.result?.success !== true || persisted.projection_checksum !== projection.checksum) {
    throw new Error("Publication audit mutation response mismatch");
  }
}

function documentFromMetaobject(metaobject, label) {
  const field = metaobject?.fields?.find((candidate) => candidate.key === "document");
  if (!field || field.jsonValue == null || typeof field.jsonValue !== "object") {
    throw new Error(`${label} document was not returned by Shopify`);
  }
  return field.jsonValue;
}

function expectedProjection({ definition, revision, snapshot }) {
  const compiled = compileRuntimeSnapshot(revision.configuration);
  if (snapshot?.checksum !== compiled.checksum) throw new Error("persisted Snapshot does not match published Revision");
  const activatedDefinition = { ...definition, active_revision_id: TARGET.revisionId };
  const candidate = derivePrebuiltBundleRuntimeMapping({
    definition: activatedDefinition,
    revision,
    snapshot,
    fixed_selections: Object.fromEntries(snapshot.groups.map((group) => [group.key, group.default_option])),
    pilot_scope: {
      schema_version: "prebuilt_bundle_pilot_scope.v1",
      pilot_scope_id: TARGET.definitionId,
      store_domain: TARGET.store,
      approved_product_series_keys: ["real-af4005pk-demo"],
      approved_parent_variant_gids: [definition.parent_binding.variant_gid],
    },
  });
  if (candidate.status !== "ready") throw new Error(`Projection recovery preparation failed: ${candidate.reason}`);
  return candidate.expand_projection;
}

function assertRecoverable(state, expected) {
  if (state.revision.status !== "published") throw new Error("Revision is not published; do not use recovery");
  if (![null, TARGET.revisionId].includes(state.definition.active_revision_id)) throw new Error("Definition pointer drift");
  if (state.activeRevisionId !== TARGET.revisionId) throw new Error("product active pointer is not the published Revision");
  if (state.projection !== null && state.projection.checksum !== expected.checksum) throw new Error("Projection drift");
  if (state.publication !== null && state.publication.projection_checksum !== expected.checksum) throw new Error("publication audit drift");
}

function assertComplete(state, expected) {
  assertRecoverable(state, expected);
  if (state.definition.active_revision_id !== TARGET.revisionId
    || state.projection?.checksum !== expected.checksum
    || state.publication?.result?.success !== true) {
    throw new Error("recovery completion read-back mismatch");
  }
}

function auditRecord(projection) {
  return {
    schema_version: "prebuilt_bundle_projection_publication.v1",
    publication_id: TARGET.publicationId,
    bundle_definition_id: TARGET.definitionId,
    revision_id: TARGET.revisionId,
    projection_checksum: projection.checksum,
    source_snapshot_checksum: projection.source_snapshot_checksum,
    created_at: TARGET.auditAt,
    result: {
      success: true,
      publication_id: TARGET.publicationId,
      bundle_definition_id: TARGET.definitionId,
      revision_id: TARGET.revisionId,
      projection_checksum: projection.checksum,
      previous_projection_checksum: null,
      compensation_required: false,
      recovered_from: "publication_transport_timeout",
    },
  };
}

function summarize(state, expected) {
  return {
    revision_status: state.revision.status,
    definition_active_revision_id: state.definition.active_revision_id,
    product_active_revision_id: state.activeRevisionId,
    snapshot_checksum: state.snapshot?.checksum ?? null,
    projection_checksum: state.projection?.checksum ?? null,
    expected_projection_checksum: expected.checksum,
    publication_record_exists: state.publication !== null,
  };
}
