import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { buildPrebuiltProjectionPublicationEvidence } from "../extensions/master-kit-expand/src/config/prebuilt-projection-publication-evidence.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const TARGET = Object.freeze({
  appConfig: "shopify.app.dev.toml",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
  bundleDefinitionId: "4b5c384b-acc6-455d-b14a-7a1e6d433ffc",
  revisionId: "e94be6f4-e08d-483b-9dcc-d80b98ee4246",
  publicationId: "4b5c384b-acc6-455d-b14a-7a1e6d433ffe",
  parentProductId: "gid://shopify/Product/10638462877974",
});

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "aces-real-bundle-publication-diagnostic-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: resolve(root, "node_modules/@shopify/cli/bin/run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: TARGET,
});

try {
  const payload = await execute(`#graphql
    query DiagnoseDevRealBundlePublication(
      $definitionType: String!
      $definitionHandle: String!
      $revisionType: String!
      $revisionHandle: String!
      $publicationType: String!
      $publicationHandle: String!
      $productId: ID!
      $namespace: String!
    ) {
      definition: metaobjectByHandle(handle: { type: $definitionType, handle: $definitionHandle }) {
        fields { key value jsonValue }
      }
      revision: metaobjectByHandle(handle: { type: $revisionType, handle: $revisionHandle }) {
        fields { key value jsonValue }
      }
      publication: metaobjectByHandle(handle: { type: $publicationType, handle: $publicationHandle }) {
        fields { key value jsonValue }
      }
      product(id: $productId) {
        title
        handle
        status
        onlineStoreUrl
        active: metafield(namespace: $namespace, key: "active_revision_id_v1") { value }
        snapshot: metafield(namespace: $namespace, key: "bundle_runtime_snapshot_v1") { jsonValue }
        projection: metafield(namespace: $namespace, key: "prebuilt_bundle_expand_projection_v1") { jsonValue }
      }
    }
  `, { variables: {
    definitionType: "$app:aces_bundle_definition_dev",
    definitionHandle: TARGET.bundleDefinitionId,
    revisionType: "$app:aces_bundle_revision_dev",
    revisionHandle: TARGET.revisionId,
    publicationType: "$app:aces_bundle_publication_record_dev",
    publicationHandle: TARGET.publicationId,
    productId: TARGET.parentProductId,
    namespace: "aces_dev",
  } });
  const definition = documentFromMetaobject(payload.data?.definition, "BundleDefinition");
  const revision = documentFromMetaobject(payload.data?.revision, "BundleRevision");
  const snapshot = compileRuntimeSnapshot(revision.configuration);
  const activeRevisionId = payload.data?.product?.active?.value ?? null;
  const persistedSnapshot = payload.data?.product?.snapshot?.jsonValue ?? null;
  const persistedProjection = payload.data?.product?.projection?.jsonValue ?? null;
  const projectionEvidence = revision.status === "draft"
    ? buildPrebuiltProjectionPublicationEvidence({
      definition,
      revision,
      snapshot,
      pilot_scope: {
        schema_version: "prebuilt_bundle_pilot_scope.v1",
        pilot_scope_id: "4b5c384b-acc6-455d-b14a-7a1e6d433ffc",
        store_domain: TARGET.store,
        approved_product_series_keys: ["real-af4005pk-demo"],
        approved_parent_variant_gids: [definition.parent_binding.variant_gid],
      },
    })
    : null;

  console.log(JSON.stringify({
    target: TARGET,
    definition: {
      id: definition.bundle_definition_id,
      slug: definition.slug,
      parent_binding: definition.parent_binding,
      active_revision_id: definition.active_revision_id,
    },
    revision: {
      id: revision.revision_id,
      status: revision.status,
      revision_number: revision.revision_number,
      component_group_count: revision.configuration.component_groups.length,
      components: revision.configuration.component_groups.flatMap((group) => group.options.map((option) => ({
        group: group.key,
        option: option.key,
        variant_gid: option.variant_gid,
        price: option.price_snapshot,
      }))),
    },
    compiled_snapshot: {
      checksum: snapshot.checksum,
      byte_size: Buffer.byteLength(JSON.stringify(snapshot), "utf8"),
      group_count: snapshot.groups.length,
      component_count: snapshot.groups.reduce((count, group) => count + group.options.length, 0),
    },
    compiled_projection: {
      checksum: projectionEvidence?.projection.checksum ?? persistedProjection?.checksum ?? null,
      components: (projectionEvidence?.projection.components ?? persistedProjection?.components ?? []).map((component) => ({
        sku: component.sku,
        variant_gid: component.variant_gid,
        price: component.fixed_price_per_unit,
      })),
    },
    existing_runtime_carriers: {
      active_revision_id: activeRevisionId,
      snapshot_checksum: persistedSnapshot?.checksum ?? null,
      projection_checksum: persistedProjection?.checksum ?? null,
    },
    parent_product: {
      title: payload.data?.product?.title ?? null,
      handle: payload.data?.product?.handle ?? null,
      status: payload.data?.product?.status ?? null,
      online_store_url: payload.data?.product?.onlineStoreUrl ?? null,
    },
    publication_record_exists: payload.data?.publication !== null,
    ready_for_controlled_publication: revision.status === "draft"
      && definition.active_revision_id === null
      && activeRevisionId === null
      && persistedSnapshot === null
      && persistedProjection === null
      && payload.data?.publication === null,
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

function documentFromMetaobject(metaobject, label) {
  const field = metaobject?.fields?.find((candidate) => candidate.key === "document");
  if (!field || field.jsonValue == null || typeof field.jsonValue !== "object") {
    throw new Error(`${label} document was not returned by Shopify`);
  }
  return field.jsonValue;
}
