import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const root = resolve(import.meta.dirname, "..");
const sourceIdentity = readArgument(process.argv.slice(2), "--source");
const outputPath = readArgument(process.argv.slice(2), "--output");
const manifestPath = readArgument(process.argv.slice(2), "--manifest")
  ?? ".local/dev-catalog-technical-batch-execution-manifest-2026-07-21.json";
if (!sourceIdentity) throw new Error("--source is required");
const manifest = JSON.parse(await readFile(resolve(root, manifestPath), "utf8"));
const record = manifest.records.find((candidate) => candidate.source_identity === sourceIdentity);
if (!record) throw new Error(`manifest source is missing: ${sourceIdentity}`);
const directory = await mkdtemp(join(tmpdir(), "aces-dev-catalog-target-reconcile-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: join(root, "node_modules", "@shopify", "cli", "bin", "run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: { appConfig: "shopify.app.dev.toml", store: "huang-mvqquz1p.myshopify.com", apiVersion: "2026-04" },
  readOnlyAttempts: 8,
  timeoutMs: 60_000,
});

try {
  const ledgerKey = `prebuilt_import_ledger_v1_${createHash("sha256").update(sourceIdentity).digest("hex").slice(0, 32)}`;
  const response = await execute(`#graphql
    query DevCatalogTechnicalBatchTargetReconciliation(
      $definitionType: String!, $definitionHandle: String!,
      $revisionType: String!, $revisionHandle: String!,
      $publicationType: String!, $publicationHandle: String!,
      $productId: ID!, $namespace: String!, $snapshotKey: String!,
      $projectionKey: String!, $activeRevisionKey: String!, $ledgerKey: String!
    ) {
      definition: metaobjectByHandle(handle: { type: $definitionType, handle: $definitionHandle }) { fields { key jsonValue } }
      revision: metaobjectByHandle(handle: { type: $revisionType, handle: $revisionHandle }) { fields { key jsonValue } }
      publication: metaobjectByHandle(handle: { type: $publicationType, handle: $publicationHandle }) { fields { key jsonValue } }
      product(id: $productId) {
        snapshot: metafield(namespace: $namespace, key: $snapshotKey) { jsonValue }
        projection: metafield(namespace: $namespace, key: $projectionKey) { jsonValue }
        activeRevision: metafield(namespace: $namespace, key: $activeRevisionKey) { value }
      }
      shop { ledger: metafield(namespace: $namespace, key: $ledgerKey) { jsonValue } }
    }
  `, { variables: {
    definitionType: "$app:aces_bundle_definition_dev",
    definitionHandle: record.bundle_definition_id,
    revisionType: "$app:aces_bundle_revision_dev",
    revisionHandle: record.revision_id,
    publicationType: "$app:aces_bundle_publication_record_dev",
    publicationHandle: record.publication_id,
    productId: record.parent_product_gid,
    namespace: "aces_dev",
    snapshotKey: "bundle_runtime_snapshot_v1",
    projectionKey: "prebuilt_bundle_expand_projection_v1",
    activeRevisionKey: "active_revision_id_v1",
    ledgerKey,
  } });
  const data = response.data;
  const report = {
    schema_version: "dev_catalog_technical_batch_target_reconciliation.v1",
    mode: "read_only",
    captured_at: new Date().toISOString(),
    manifest_checksum: manifest.checksum,
    shopify_writes_performed: false,
    source_identity: sourceIdentity,
    expected: {
      definition_id: record.bundle_definition_id,
      revision_id: record.revision_id,
      publication_id: record.publication_id,
      snapshot_checksum: record.snapshot_checksum,
      projection_checksum: record.projection_checksum,
    },
    observed: {
      definition: document(data.definition),
      revision: document(data.revision),
      publication: document(data.publication),
      snapshot: data.product?.snapshot?.jsonValue ?? null,
      projection: data.product?.projection?.jsonValue ?? null,
      active_revision_id: data.product?.activeRevision?.value ?? null,
      ledger: data.shop?.ledger?.jsonValue ?? null,
    },
  };
  if (outputPath) await writeFile(resolve(root, outputPath), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8" });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

function document(metaobject) {
  return metaobject?.fields?.find((field) => field.key === "document")?.jsonValue ?? null;
}

function readArgument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
