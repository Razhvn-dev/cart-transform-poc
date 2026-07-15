import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { masterKitConfigV1 } from "../extensions/master-kit-expand/src/config/fixtures/master-kit-config.v1.js";
import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { DEV_SHOPIFY_PERSISTENCE_BINDINGS } from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";

const execFileAsync = promisify(execFile);
const cliEntrypoint = join(process.env.APPDATA, "npm", "node_modules", "@shopify", "cli", "bin", "run.js");
const root = fileURLToPath(new URL("..", import.meta.url));
const tempDirectory = await mkdtemp(join(tmpdir(), "aces-phase-4-4d-"));
const store = "huang-mvqquz1p.myshopify.com";
const definitionId = "44440000-0000-4000-8000-000000000001";
const revisionId = "44440000-0000-4000-8000-000000000002";
const publicationId = "44440000-0000-4000-8000-000000000003";
const now = "2026-07-15T08:30:00Z";
let requestNumber = 0;

const definition = {
  schema_version: "bundle_definition.v1", bundle_definition_id: definitionId,
  slug: "aces-master-kit-phase-4-4d-dev",
  parent_binding: { product_gid: masterKitConfigV1.parent.product_gid, variant_gid: masterKitConfigV1.parent.variant_gid },
  active_revision_id: null, created_at: now, updated_at: now,
};
const configuration = structuredClone(masterKitConfigV1);
configuration.configuration_id = definitionId;
configuration.configuration_version = 1;
configuration.status = "draft";
configuration.revision = { draft_revision: 1, published_revision: 1 };
const revision = {
  schema_version: "bundle_revision.v1", revision_id: revisionId, bundle_definition_id: definitionId,
  revision_number: 1, status: "draft", configuration, runtime_snapshot_ref: null,
  created_at: now, updated_at: now, created_by: "phase-4-4d-dev-validation",
};
const snapshot = compileRuntimeSnapshot(configuration);
const publication = {
  schema_version: "bundle_publication_attempt.v1", publication_id: publicationId,
  bundle_definition_id: definitionId, revision_id: revisionId, revision_number: 1,
  retry_identity: `${definitionId}:${revisionId}:${snapshot.checksum}`, attempt_number: 1, state: "pending",
  runtime_snapshot_ref: { schema_version: snapshot.snapshot_schema, checksum_algorithm: snapshot.checksum_algorithm, checksum: snapshot.checksum, configuration_version: 1 },
  previous_active_revision_id: null, created_at: now, updated_at: now,
};

try {
  const created = await execute(createMutation(), {
    definition: metaobjectInput(DEV_SHOPIFY_PERSISTENCE_BINDINGS.metaobjectTypes.bundleDefinition, definitionId, definition),
    revision: metaobjectInput(DEV_SHOPIFY_PERSISTENCE_BINDINGS.metaobjectTypes.bundleRevision, revisionId, revision),
    publication: metaobjectInput(DEV_SHOPIFY_PERSISTENCE_BINDINGS.metaobjectTypes.publicationRecord, publicationId, publication),
    metafields: [
      { ownerId: masterKitConfigV1.parent.product_gid, namespace: "aces_dev", key: "bundle_runtime_snapshot_v1", type: "json", value: JSON.stringify(snapshot), compareDigest: null },
      { ownerId: masterKitConfigV1.parent.product_gid, namespace: "aces_dev", key: "active_revision_id_v1", type: "single_line_text_field", value: revisionId, compareDigest: null },
    ],
  });
  assertNoErrors(created.createDefinition.userErrors, "BundleDefinition create");
  assertNoErrors(created.createRevision.userErrors, "BundleRevision create");
  assertNoErrors(created.createPublication.userErrors, "PublicationRecord create");
  assertNoErrors(created.writeMetafields.userErrors, "dev metafields write");

  const readBack = await execute(readBackQuery(), {});
  assertEqual(readBack.definition?.handle, definitionId, "BundleDefinition read-back");
  assertEqual(readBack.revision?.handle, revisionId, "BundleRevision read-back");
  assertEqual(readBack.publication?.handle, publicationId, "PublicationRecord idempotent lookup");
  const persistedSnapshot = readBack.product?.snapshot?.jsonValue;
  assertEqual(persistedSnapshot?.checksum, snapshot.checksum, "Snapshot checksum");
  assertEqual(persistedSnapshot?.configuration_version, 1, "Snapshot version");
  assertEqual(readBack.product?.activeRevision?.value, revisionId, "active revision pointer");

  const stale = await execute(staleCasMutation(), {
    metafields: [{
      ownerId: masterKitConfigV1.parent.product_gid, namespace: "aces_dev", key: "bundle_runtime_snapshot_v1", type: "json",
      value: JSON.stringify(snapshot), compareDigest: "0000000000000000000000000000000000000000000000000000000000000000",
    }],
  });
  const staleError = stale.staleWrite.userErrors.find((error) => error.code === "INVALID_COMPARE_DIGEST");
  if (!staleError) throw new Error("stale compareDigest was not rejected by Shopify");

  console.log(JSON.stringify({ status: "passed", definition_id: definitionId, revision_id: revisionId, publication_id: publicationId,
    snapshot_checksum: snapshot.checksum, snapshot_compare_digest: readBack.product.snapshot.compareDigest,
    active_revision_compare_digest: readBack.product.activeRevision.compareDigest, stale_cas_error: staleError.code }, null, 2));
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

function metaobjectInput(type, handle, document) {
  return { type, handle, fields: [{ key: "document", value: JSON.stringify(document) }] };
}

async function execute(query, variables) {
  const outputFile = join(tempDirectory, `response-${requestNumber += 1}.json`);
  await execFileAsync(process.execPath, [cliEntrypoint, "app", "execute", "--config", "shopify.app.dev.toml", "--store", store,
    "--version", "2026-04", "--query", query, "--variables", JSON.stringify(variables), "--output-file", outputFile, "--no-color"],
  { cwd: root, windowsHide: true });
  return JSON.parse(await readFile(outputFile, "utf8"));
}

function assertNoErrors(errors, label) { if (errors.length) throw new Error(`${label}: ${errors.map((error) => error.message).join("; ")}`); }
function assertEqual(actual, expected, label) { if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`); }

function createMutation() { return `#graphql
  mutation Phase44DCreate($definition: MetaobjectCreateInput!, $revision: MetaobjectCreateInput!, $publication: MetaobjectCreateInput!, $metafields: [MetafieldsSetInput!]!) {
    createDefinition: metaobjectCreate(metaobject: $definition) { metaobject { id handle } userErrors { code message } }
    createRevision: metaobjectCreate(metaobject: $revision) { metaobject { id handle } userErrors { code message } }
    createPublication: metaobjectCreate(metaobject: $publication) { metaobject { id handle } userErrors { code message } }
    writeMetafields: metafieldsSet(metafields: $metafields) { metafields { id compareDigest } userErrors { code message } }
  }`; }
function readBackQuery() { return `#graphql
  query Phase44DReadBack {
    definition: metaobjectByHandle(handle: { type: "$app:aces_bundle_definition_dev", handle: "44440000-0000-4000-8000-000000000001" }) { id handle fields { key jsonValue } }
    revision: metaobjectByHandle(handle: { type: "$app:aces_bundle_revision_dev", handle: "44440000-0000-4000-8000-000000000002" }) { id handle fields { key jsonValue } }
    publication: metaobjectByHandle(handle: { type: "$app:aces_bundle_publication_record_dev", handle: "44440000-0000-4000-8000-000000000003" }) { id handle fields { key jsonValue } }
    product(id: "gid://shopify/Product/10600519598358") {
      snapshot: metafield(namespace: "aces_dev", key: "bundle_runtime_snapshot_v1") { jsonValue compareDigest }
      activeRevision: metafield(namespace: "aces_dev", key: "active_revision_id_v1") { value compareDigest }
    }
  }`; }
function staleCasMutation() { return `#graphql
  mutation Phase44DStaleCas($metafields: [MetafieldsSetInput!]!) {
    staleWrite: metafieldsSet(metafields: $metafields) { userErrors { code message } }
  }`; }
