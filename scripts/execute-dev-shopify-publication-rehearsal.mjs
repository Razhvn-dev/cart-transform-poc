import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { createBundlePublicationPersistenceDriver } from "../extensions/master-kit-expand/src/config/bundle-publication.persistence-driver.js";
import { publishDraftRevision, rollbackPublishedRevision } from "../extensions/master-kit-expand/src/config/bundle-publication.service.js";
import {
  DEV_SHOPIFY_APP_CLIENT_ID,
  createDevShopifyPersistenceAdapter,
} from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import { generatePublicationPromotionEvidence } from "./generate-publication-promotion-evidence.mjs";
import {
  DEV_PUBLICATION_REHEARSAL_BINDINGS,
  DEV_PUBLICATION_REHEARSAL_TARGET,
} from "./dev-shopify-publication-rehearsal.js";
import {
  DEV_PUBLICATION_REHEARSAL_RUN_ID,
  assertRehearsalOperationIsolated,
  buildDevPublicationRehearsalReconciliationQuery,
  buildStaleRehearsalSnapshotCasMutation,
  createDevPublicationRehearsalExecution,
  summarizeDevPublicationRehearsalReconciliation,
} from "./dev-shopify-publication-rehearsal.execution.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cliEntrypoint = join(process.env.APPDATA ?? "", "npm", "node_modules", "@shopify", "cli", "bin", "run.js");
const directory = await mkdtemp(join(tmpdir(), "aces-dev-publication-rehearsal-"));
const runId = process.argv.slice(2).find((argument) => !argument.startsWith("--"))
  ?? DEV_PUBLICATION_REHEARSAL_RUN_ID;
const execution = createDevPublicationRehearsalExecution(runId);
const executeCli = createShopifyCliReadSafeExecutor({
  cliEntrypoint,
  directory,
  execFileAsync,
  root,
  target: DEV_PUBLICATION_REHEARSAL_TARGET,
});

try {
  if (process.argv.includes("--reconcile-only")) {
    const payload = await execute(buildDevPublicationRehearsalReconciliationQuery(runId));
    const output = process.argv.includes("--summary")
      ? { status: "read_only", run_id: runId, summary: summarizeDevPublicationRehearsalReconciliation(payload.data) }
      : { status: "read_only", run_id: runId, remote: payload.data };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = 0;
  } else {
  const persistence = createDevShopifyPersistenceAdapter({
    appClientId: DEV_SHOPIFY_APP_CLIENT_ID,
    bindings: {
      metaobjectTypes: {
        bundleDefinition: "$app:aces_bundle_definition_dev",
        bundleRevision: "$app:aces_bundle_revision_dev",
        publicationRecord: "$app:aces_bundle_publication_record_dev",
      },
      documentFieldKey: "document",
      metafields: DEV_PUBLICATION_REHEARSAL_BINDINGS,
    },
    execute,
  });
  const driver = createBundlePublicationPersistenceDriver({ persistence });

  const definition = await ensureDefinition(persistence, execution.definition);
  const baselineRevision = await ensureRevision(persistence, execution.baselineRevision);
  const baselineSnapshot = compileRuntimeSnapshot(baselineRevision.configuration);
  const baselineResult = await publishOrReuse({
    publicationId: execution.identifiers.baselinePublicationId,
    definition,
    revisions: [baselineRevision],
    revisionId: baselineRevision.revision_id,
    snapshot: baselineSnapshot,
    driver,
  });

  const candidateRevision = await ensureRevision(persistence, execution.candidateRevision);
  const candidateSnapshot = compileRuntimeSnapshot(candidateRevision.configuration);
  const candidateResult = await publishOrReuse({
    publicationId: execution.identifiers.candidatePublicationId,
    definition: baselineResult.domain.definition,
    revisions: [...baselineResult.domain.revisions, candidateRevision],
    revisionId: candidateRevision.revision_id,
    snapshot: candidateSnapshot,
    driver,
  });
  const idempotentRetry = await publishDraftRevision({
    publication_id: execution.identifiers.candidatePublicationId,
    definition: candidateResult.domain.definition,
    revisions: candidateResult.domain.revisions,
    revision_id: candidateRevision.revision_id,
    promotion: { evidence: generatePublicationPromotionEvidence({
      bundleDefinitionId: execution.identifiers.bundleDefinitionId,
      revisionId: candidateRevision.revision_id,
      snapshot: candidateSnapshot,
    }) },
    at: execution.definition.updated_at,
  }, driver);
  if (!idempotentRetry.success || !idempotentRetry.warnings.includes("idempotent_retry")) {
    throw new Error("publication retry did not return the persisted idempotent result");
  }

  const rollbackResult = await rollbackOrReuse({
    publicationId: execution.identifiers.rollbackPublicationId,
    definition: candidateResult.domain.definition,
    revisions: candidateResult.domain.revisions,
    targetRevisionId: baselineRevision.revision_id,
    targetSnapshot: baselineSnapshot,
    driver,
  });
  const beforeStaleCas = await readRehearsalCarriers();
  const stale = await execute(buildStaleRehearsalSnapshotCasMutation(), {
    variables: {
      metafields: [{
        ownerId: execution.definition.parent_binding.product_gid,
        namespace: DEV_PUBLICATION_REHEARSAL_BINDINGS.namespace,
        key: DEV_PUBLICATION_REHEARSAL_BINDINGS.runtimeSnapshotKey,
        type: "json",
        value: JSON.stringify(beforeStaleCas.snapshot.jsonValue),
        compareDigest: "0000000000000000000000000000000000000000000000000000000000000000",
      }],
    },
  });
  const staleError = stale.data?.staleWrite?.userErrors?.find((error) => error.code === "INVALID_COMPARE_DIGEST");
  if (!staleError) throw new Error("stale Snapshot compareDigest was not rejected by Shopify");
  const finalCarriers = await readRehearsalCarriers();
  if (finalCarriers.snapshot.jsonValue?.checksum !== beforeStaleCas.snapshot.jsonValue?.checksum) {
    throw new Error("stale CAS changed the isolated Snapshot");
  }
  if (finalCarriers.activeRevision.value !== beforeStaleCas.activeRevision.value) {
    throw new Error("stale CAS changed the isolated active revision pointer");
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    target: DEV_PUBLICATION_REHEARSAL_TARGET,
    run_id: execution.identifiers.bundleDefinitionId,
    definition_id: execution.identifiers.bundleDefinitionId,
    revision_ids: [execution.identifiers.baselineRevisionId, execution.identifiers.candidateRevisionId],
    publication_ids: [
      execution.identifiers.baselinePublicationId,
      execution.identifiers.candidatePublicationId,
      execution.identifiers.rollbackPublicationId,
    ],
    baseline: summarizeResult(baselineResult),
    candidate: summarizeResult(candidateResult),
    rollback: summarizeResult(rollbackResult),
    idempotent_retry: idempotentRetry.warnings.includes("idempotent_retry"),
    stale_cas_error: staleError.code,
    snapshot: {
      checksum: finalCarriers.snapshot.jsonValue?.checksum ?? null,
      configuration_version: finalCarriers.snapshot.jsonValue?.configuration_version ?? null,
      compare_digest: finalCarriers.snapshot.compareDigest ?? null,
    },
    active_revision: {
      value: finalCarriers.activeRevision.value ?? null,
      compare_digest: finalCarriers.activeRevision.compareDigest ?? null,
    },
  }, null, 2)}\n`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function publishOrReuse({ publicationId, definition, revisions, revisionId, snapshot, driver }) {
  const existing = await driver.readPublicationRecord(publicationId);
  if (existing?.result?.success) return existing.result;
  if (existing) throw new Error(`publication "${publicationId}" exists without a successful result; reconcile before retrying`);
  const result = await publishDraftRevision({
    publication_id: publicationId,
    definition,
    revisions,
    revision_id: revisionId,
    promotion: { evidence: generatePublicationPromotionEvidence({
      bundleDefinitionId: definition.bundle_definition_id,
      revisionId,
      snapshot,
    }) },
    at: execution.definition.updated_at,
  }, driver);
  if (!result.success) throw new Error(`publication failed at ${result.failed_step}: ${result.error}`);
  return result;
}

async function rollbackOrReuse({ publicationId, definition, revisions, targetRevisionId, targetSnapshot, driver }) {
  const existing = await driver.readPublicationRecord(publicationId);
  if (existing?.result?.success) return existing.result;
  if (existing) throw new Error(`rollback "${publicationId}" exists without a successful result; reconcile before retrying`);
  const result = await rollbackPublishedRevision({
    publication_id: publicationId,
    definition,
    revisions,
    target_revision_id: targetRevisionId,
    target_snapshot: targetSnapshot,
    promotion: { evidence: generatePublicationPromotionEvidence({
      bundleDefinitionId: definition.bundle_definition_id,
      revisionId: targetRevisionId,
      snapshot: targetSnapshot,
    }) },
    at: execution.definition.updated_at,
  }, driver);
  if (!result.success) throw new Error(`rollback failed at ${result.failed_step}: ${result.error}`);
  return result;
}

async function ensureDefinition(persistence, definition) {
  try {
    const existing = await persistence.readBundleDefinition(definition.bundle_definition_id);
    assertSameIdentity(existing, definition, "BundleDefinition");
    return existing;
  } catch (error) {
    if (error?.code !== "NOT_FOUND") throw error;
    return persistence.writeBundleDefinition({ definition });
  }
}

async function ensureRevision(persistence, revision) {
  try {
    const existing = await persistence.readRevision(revision.revision_id);
    assertSameIdentity(existing, revision, "BundleRevision");
    return existing;
  } catch (error) {
    if (error?.code !== "NOT_FOUND") throw error;
    return persistence.writeRevision({ revision });
  }
}

function assertSameIdentity(existing, expected, label) {
  const id = existing.bundle_definition_id ?? existing.revision_id;
  const expectedId = expected.bundle_definition_id ?? expected.revision_id;
  if (id !== expectedId || existing.bundle_definition_id !== expected.bundle_definition_id) {
    throw new Error(`${label} handle is already owned by a different rehearsal domain`);
  }
}

async function readRehearsalCarriers() {
  const payload = await execute(assertRehearsalOperationIsolated(`#graphql
    query DevPublicationRehearsalCarrierRead($productId: ID!, $namespace: String!, $snapshotKey: String!, $activeRevisionKey: String!) {
      product(id: $productId) {
        snapshot: metafield(namespace: $namespace, key: $snapshotKey) { value jsonValue compareDigest }
        activeRevision: metafield(namespace: $namespace, key: $activeRevisionKey) { value compareDigest }
      }
    }
  `), {
    variables: {
      productId: execution.definition.parent_binding.product_gid,
      namespace: DEV_PUBLICATION_REHEARSAL_BINDINGS.namespace,
      snapshotKey: DEV_PUBLICATION_REHEARSAL_BINDINGS.runtimeSnapshotKey,
      activeRevisionKey: DEV_PUBLICATION_REHEARSAL_BINDINGS.activeRevisionKey,
    },
  });
  const snapshot = payload.data?.product?.snapshot;
  const activeRevision = payload.data?.product?.activeRevision;
  if (!snapshot?.jsonValue || !activeRevision?.value) {
    throw new Error("isolated rehearsal carriers were not persisted");
  }
  return { snapshot, activeRevision };
}

async function execute(query, { variables = {} } = {}) {
  assertRehearsalOperationIsolated(query);
  return executeCli(query, { variables });
}

function summarizeResult(result) {
  return {
    success: result.success,
    active_revision_id: result.active_revision_id,
    snapshot_checksum: result.snapshot_checksum,
    completed_steps: result.completed_steps,
  };
}
