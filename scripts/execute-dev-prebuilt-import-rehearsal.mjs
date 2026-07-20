import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

import { createDevShopifyBundleAdminService } from "../app/domains/bundle-admin/bundle-admin.shopify-service.server.js";
import { BundlePersistenceError } from "../extensions/master-kit-expand/src/config/bundle-persistence.adapter.js";
import { executeConfirmedPrebuiltBundleImport } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.execution.js";
import { createPrebuiltBundleImportPlanFromPackage } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.package.js";
import { compilePrebuiltBundleImportTarget } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.target.js";
import { assessPrebuiltBundleImportRecovery } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.recovery.js";
import { createShopifyPrebuiltBundleImportLedger } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.shopify-ledger.js";
import { createPrebuiltBundleImportTargetWriter } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.target-persistence.js";
import {
  DEV_SHOPIFY_APP_CLIENT_ID,
  createDevShopifyPersistenceAdapter,
} from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import {
  DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS,
  DEV_PREBUILT_IMPORT_REHEARSAL_RUNS,
  DEV_PREBUILT_IMPORT_REHEARSAL_TARGET,
  assertDevPrebuiltImportRehearsalBindings,
  createDevPrebuiltImportRehearsalPackage,
  excludedComponentProductGids,
} from "./dev-prebuilt-import-rehearsal.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";
import { createShopifySessionAdminExecutor } from "./shopify-session-admin-executor.js";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cliEntrypoint = join(process.env.APPDATA ?? "", "npm", "node_modules", "@shopify", "cli", "bin", "run.js");
const directory = await mkdtemp(join(tmpdir(), "aces-dev-prebuilt-import-rehearsal-"));
const executeCli = createShopifyCliReadSafeExecutor({
  cliEntrypoint,
  directory,
  execFileAsync,
  root,
  target: DEV_PREBUILT_IMPORT_REHEARSAL_TARGET,
  readOnlyAttempts: 8,
  timeoutMs: 60_000,
});
let prisma = null;
let execute = executeCli;
if (process.argv.includes("--session-transport")) {
  const localCredentials = parseEnvFile(await readFile(join(root, ".env.docker"), "utf8"));
  if (localCredentials.SHOPIFY_API_KEY !== DEV_SHOPIFY_APP_CLIENT_ID) {
    throw new Error("local credentials do not belong to cart-transform-poc-dev");
  }
  prisma = new PrismaClient();
  execute = createShopifySessionAdminExecutor({
    prisma,
    shop: DEV_PREBUILT_IMPORT_REHEARSAL_TARGET.store,
    apiVersion: DEV_PREBUILT_IMPORT_REHEARSAL_TARGET.apiVersion,
    clientId: localCredentials.SHOPIFY_API_KEY,
    clientSecret: localCredentials.SHOPIFY_API_SECRET,
  });
}

try {
  assertDevPrebuiltImportRehearsalBindings();
  const persistence = createDevShopifyPersistenceAdapter({
    appClientId: DEV_SHOPIFY_APP_CLIENT_ID,
    bindings: DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS,
    execute,
  });
  const definitions = await persistence.listBundleDefinitions();
  const { products, shopId } = await readCandidateProducts(execute);
  const parents = selectRehearsalParents({ products, definitions });
  const successPackage = createDevPrebuiltImportRehearsalPackage({
    run: DEV_PREBUILT_IMPORT_REHEARSAL_RUNS.success,
    parent: parents.success,
  });
  const partialPackage = createDevPrebuiltImportRehearsalPackage({
    run: DEV_PREBUILT_IMPORT_REHEARSAL_RUNS.partial,
    parent: parents.partial,
  });
  const plans = {
    success: requireReadyPlan(successPackage, definitions),
    partial: requireReadyPlan(partialPackage, definitions),
  };

  if (process.argv.includes("--reconcile-only")) {
    process.stdout.write(`${JSON.stringify({
      status: "read_only_reconciliation",
      target: DEV_PREBUILT_IMPORT_REHEARSAL_TARGET,
      ...(await readCombinedReconciliation({ executeGraphql: execute, plans, parents })),
    }, null, 2)}\n`);
  } else if (process.argv.includes("--preflight-only")) {
    process.stdout.write(`${JSON.stringify({
      status: "read_only_ready",
      target: DEV_PREBUILT_IMPORT_REHEARSAL_TARGET,
      bindings: DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS.metafields,
      parents,
      plans: {
        success: summarizePlan(plans.success),
        partial: summarizePlan(plans.partial),
      },
    }, null, 2)}\n`);
  } else if (process.argv.includes("--batch-success")) {
    const batch = await runBatchedSuccessfulImport({
      executeGraphql: execute,
      persistence,
      packageValue: successPackage,
      plan: plans.success,
      plans,
      parents,
      shopId,
    });
    const { success, reconciliation } = batch;
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      target: DEV_PREBUILT_IMPORT_REHEARSAL_TARGET,
      isolated_bindings: DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS.metafields,
      success,
      partial_recovery: verifyObservedPartialRecovery({ plan: plans.partial, state: reconciliation.partial }),
    }, null, 2)}\n`);
  } else {
    const success = await runSuccessfulImport({ execute, persistence, packageValue: successPackage, plan: plans.success });
    const partial = await runPartialRecovery({ persistence, packageValue: partialPackage, plan: plans.partial });
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      target: DEV_PREBUILT_IMPORT_REHEARSAL_TARGET,
      isolated_bindings: DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS.metafields,
      success,
      partial_recovery: partial,
    }, null, 2)}\n`);
  }
} finally {
  await prisma?.$disconnect();
  await rm(directory, { recursive: true, force: true });
}

async function readCombinedReconciliation({ executeGraphql, plans, parents }) {
  const namespace = DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS.metafields.namespace;
  const keys = DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS.metafields;
  const payload = await executeGraphql(`#graphql
    query DevPrebuiltImportCombinedReconciliation(
      $definitionType: String!
      $revisionType: String!
      $successDefinitionHandle: String!
      $partialDefinitionHandle: String!
      $successProductId: ID!
      $partialProductId: ID!
      $namespace: String!
      $snapshotKey: String!
      $projectionKey: String!
      $activeKey: String!
      $successLedgerKey: String!
      $partialLedgerKey: String!
      $publicationType: String!
      $successPublicationHandle: String!
    ) {
      successDefinition: metaobjectByHandle(handle: { type: $definitionType, handle: $successDefinitionHandle }) {
        fields { key value jsonValue }
      }
      partialDefinition: metaobjectByHandle(handle: { type: $definitionType, handle: $partialDefinitionHandle }) {
        fields { key value jsonValue }
      }
      revisions: metaobjects(type: $revisionType, first: 250) {
        nodes { fields { key value jsonValue } }
      }
      successPublication: metaobjectByHandle(handle: { type: $publicationType, handle: $successPublicationHandle }) {
        fields { key value jsonValue }
      }
      shop {
        id
        successLedger: metafield(namespace: $namespace, key: $successLedgerKey) { value jsonValue compareDigest }
        partialLedger: metafield(namespace: $namespace, key: $partialLedgerKey) { value jsonValue compareDigest }
      }
      successProduct: product(id: $successProductId) {
        snapshot: metafield(namespace: $namespace, key: $snapshotKey) { jsonValue compareDigest }
        projection: metafield(namespace: $namespace, key: $projectionKey) { jsonValue compareDigest }
        active: metafield(namespace: $namespace, key: $activeKey) { value compareDigest }
      }
      partialProduct: product(id: $partialProductId) {
        snapshot: metafield(namespace: $namespace, key: $snapshotKey) { jsonValue compareDigest }
        projection: metafield(namespace: $namespace, key: $projectionKey) { jsonValue compareDigest }
        active: metafield(namespace: $namespace, key: $activeKey) { value compareDigest }
      }
    }`, { variables: {
    definitionType: DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS.metaobjectTypes.bundleDefinition,
    revisionType: DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS.metaobjectTypes.bundleRevision,
    successDefinitionHandle: plans.success.records[0].target.bundle_definition_id,
    partialDefinitionHandle: plans.partial.records[0].target.bundle_definition_id,
    successProductId: parents.success.product_gid,
    partialProductId: parents.partial.product_gid,
    namespace,
    snapshotKey: keys.runtimeSnapshotKey,
    projectionKey: keys.prebuiltExpandProjectionKey,
    activeKey: keys.activeRevisionKey,
    successLedgerKey: ledgerKey(plans.success.records[0].source_identity),
    partialLedgerKey: ledgerKey(plans.partial.records[0].source_identity),
    publicationType: DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS.metaobjectTypes.publicationRecord,
    successPublicationHandle: DEV_PREBUILT_IMPORT_REHEARSAL_RUNS.success.publicationId,
  } });
  const allRevisions = (payload.data?.revisions?.nodes ?? []).map(documentFromNode).filter(Boolean);
  return {
    success: summarizeCombinedState({
      plan: plans.success,
      definition: documentFromNode(payload.data?.successDefinition),
      revisions: allRevisions,
      ledgerMetafield: payload.data?.shop?.successLedger ?? null,
      product: payload.data?.successProduct,
      publication: documentFromNode(payload.data?.successPublication),
      shopId: payload.data?.shop?.id,
    }),
    partial: summarizeCombinedState({
      plan: plans.partial,
      definition: documentFromNode(payload.data?.partialDefinition),
      revisions: allRevisions,
      ledgerMetafield: payload.data?.shop?.partialLedger ?? null,
      product: payload.data?.partialProduct,
      shopId: payload.data?.shop?.id,
    }),
  };
}

function summarizeCombinedState({ plan, definition, revisions, ledgerMetafield, product, publication = null, shopId }) {
  const definitionId = plan.records[0].target.bundle_definition_id;
  return {
    source_identity: plan.records[0].source_identity,
    shop_id: shopId ?? null,
    ledger: ledgerMetafield?.jsonValue ?? null,
    ledger_compare_digest: ledgerMetafield?.compareDigest ?? null,
    definition,
    revisions: revisions
      .filter((revision) => revision.bundle_definition_id === definitionId)
      .map((revision) => ({ revision_id: revision.revision_id, status: revision.status })),
    snapshot_checksum: product?.snapshot?.jsonValue?.checksum ?? null,
    projection_checksum: product?.projection?.jsonValue?.checksum ?? null,
    active_revision_id: product?.active?.value ?? null,
    publication,
  };
}

function documentFromNode(node) {
  return node?.fields?.find((field) => field.key === "document")?.jsonValue ?? null;
}

async function runBatchedSuccessfulImport({ executeGraphql, packageValue, plan, plans, parents, shopId }) {
  const record = plan.records[0];
  const run = DEV_PREBUILT_IMPORT_REHEARSAL_RUNS.success;
  const at = "2026-07-20T08:00:00Z";
  const initial = await readCombinedReconciliation({ executeGraphql, plans, parents });
  if (initial.success.ledger !== null || hasObservedTargetState(initial.success)) {
    if (isCompletedImportState({ plan, state: initial.success, run }) && isCompletedObservedTargetState(initial.success)) {
      const verified = await readCombinedReconciliation({ executeGraphql, plans, parents });
      if (!sameJson(verified.success.ledger, initial.success.ledger)
        || verified.success.ledger_compare_digest !== initial.success.ledger_compare_digest) {
        throw new Error("stale retry CAS changed the completed rehearsal ledger");
      }
      return {
        success: summarizeCompletedBatch({
          state: verified.success,
          run,
          firstStatus: "already_completed",
          staleCas: "UNCHANGED_AFTER_PRIOR_STALE_ATTEMPT",
        }),
        reconciliation: verified,
      };
    }
    throw new Error("successful rehearsal already has incomplete or conflicting durable state; reconcile instead of retrying");
  }
  if (initial.success.shop_id !== shopId) throw new Error("candidate-product Shop ID does not match reconciliation Shop ID");

  const compiled = compilePrebuiltBundleImportTarget({
    record,
    pilot_scope: packageValue.pilot_scope,
    revision_id: run.revisionId,
    created_at: at,
    created_by: "dev-prebuilt-import-batch-rehearsal",
  });
  if (compiled.status !== "ready") throw new Error(`successful rehearsal compilation failed: ${compiled.reason}`);

  const completedSteps = [
    "definition_staged", "revision_written", "snapshot_written", "projection_written",
    "active_pointer_updated", "definition_activated", "audit_recorded",
  ];
  const result = {
    success: true,
    import_id: plan.import_id,
    publication_id: run.publicationId,
    source_identity: record.source_identity,
    bundle_definition_id: compiled.definition.bundle_definition_id,
    revision_id: compiled.revision.revision_id,
    snapshot_checksum: compiled.snapshot.checksum,
    projection_checksum: compiled.expand_projection.checksum,
    completed_steps: completedSteps,
    recovery_required: false,
  };
  const pending = {
    schema_version: "prebuilt_bundle_import_ledger.v1",
    import_id: plan.import_id,
    source_identity: record.source_identity,
    source_fingerprint: record.source_fingerprint,
    target_bundle_definition_id: record.target.bundle_definition_id,
    target_fingerprint: record.target_fingerprint,
    state: "pending",
    created_at: at,
    updated_at: at,
  };
  const completed = { ...pending, state: "completed", completed_at: at, target_result: result };
  const publication = {
    schema_version: "prebuilt_bundle_import_target_persistence.v1",
    import_id: plan.import_id,
    publication_id: run.publicationId,
    source_identity: record.source_identity,
    source_fingerprint: record.source_fingerprint,
    target_fingerprint: record.target_fingerprint,
    created_at: at,
    result,
  };
  const bindings = DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS;
  const metafields = bindings.metafields;
  const documentField = (document) => [{ key: bindings.documentFieldKey, value: JSON.stringify(document) }];
  const mutation = await executeGraphql(`#graphql
    mutation DevPrebuiltImportBatchCreate(
      $pendingLedger: [MetafieldsSetInput!]!
      $definition: MetaobjectCreateInput!
      $revision: MetaobjectCreateInput!
      $carriers: [MetafieldsSetInput!]!
      $activatedDefinitionHandle: MetaobjectHandleInput!
      $activatedDefinition: MetaobjectUpsertInput!
      $publication: MetaobjectCreateInput!
    ) {
      pendingLedger: metafieldsSet(metafields: $pendingLedger) {
        metafields { value jsonValue compareDigest }
        userErrors { field message code }
      }
      definition: metaobjectCreate(metaobject: $definition) {
        metaobject { fields { key value jsonValue } }
        userErrors { field message code }
      }
      revision: metaobjectCreate(metaobject: $revision) {
        metaobject { fields { key value jsonValue } }
        userErrors { field message code }
      }
      carriers: metafieldsSet(metafields: $carriers) {
        metafields { value jsonValue compareDigest }
        userErrors { field message code }
      }
      activatedDefinition: metaobjectUpsert(handle: $activatedDefinitionHandle, metaobject: $activatedDefinition) {
        metaobject { fields { key value jsonValue } }
        userErrors { field message code }
      }
      publication: metaobjectCreate(metaobject: $publication) {
        metaobject { fields { key value jsonValue } }
        userErrors { field message code }
      }
    }`, { variables: {
    pendingLedger: [{
      ownerId: shopId,
      namespace: metafields.namespace,
      key: ledgerKey(record.source_identity),
      type: "json",
      value: JSON.stringify(pending),
      compareDigest: null,
    }],
    definition: {
      type: bindings.metaobjectTypes.bundleDefinition,
      handle: run.definitionId,
      fields: documentField({ ...compiled.definition, active_revision_id: null }),
    },
    revision: {
      type: bindings.metaobjectTypes.bundleRevision,
      handle: run.revisionId,
      fields: documentField(compiled.revision),
    },
    carriers: [
      { ownerId: parents.success.product_gid, namespace: metafields.namespace, key: metafields.runtimeSnapshotKey, type: "json", value: JSON.stringify(compiled.snapshot), compareDigest: null },
      { ownerId: parents.success.product_gid, namespace: metafields.namespace, key: metafields.prebuiltExpandProjectionKey, type: "json", value: JSON.stringify(compiled.expand_projection), compareDigest: null },
      { ownerId: parents.success.product_gid, namespace: metafields.namespace, key: metafields.activeRevisionKey, type: "single_line_text_field", value: run.revisionId, compareDigest: null },
    ],
    activatedDefinitionHandle: { type: bindings.metaobjectTypes.bundleDefinition, handle: run.definitionId },
    activatedDefinition: { fields: documentField(compiled.definition) },
    publication: {
      type: bindings.metaobjectTypes.publicationRecord,
      handle: run.publicationId,
      fields: documentField(publication),
    },
  } });
  assertMutationUserErrors(mutation, ["pendingLedger", "definition", "revision", "carriers", "activatedDefinition", "publication"]);

  const pendingState = await readCombinedReconciliation({ executeGraphql, plans, parents });
  if (!sameJson(pendingState.success.ledger, pending)
    || !isExactTargetState({ state: pendingState.success, compiled, publication })) {
    throw new Error("batched rehearsal write did not reach the expected pending durable boundary");
  }
  if (!pendingState.success.ledger_compare_digest) throw new Error("pending rehearsal ledger is missing compareDigest");
  const completion = await executeGraphql(`#graphql
    mutation DevPrebuiltImportComplete($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { value jsonValue compareDigest }
        userErrors { field message code }
      }
    }`, { variables: { metafields: [{
    ownerId: shopId,
    namespace: metafields.namespace,
    key: ledgerKey(record.source_identity),
    type: "json",
    value: JSON.stringify(completed),
    compareDigest: pendingState.success.ledger_compare_digest,
  }] } });
  assertMutationUserErrors(completion, ["metafieldsSet"]);

  const staleError = await rejectLedgerStaleCas({
    executeGraphql,
    shopId,
    record,
    value: pending,
    compareDigest: pendingState.success.ledger_compare_digest,
  });

  const finalState = await readCombinedReconciliation({ executeGraphql, plans, parents });
  if (!isCompletedImportState({ plan, state: finalState.success, run })
    || !isExactTargetState({ state: finalState.success, compiled, publication })) {
    throw new Error("completed rehearsal durable read-back parity failed");
  }
  return {
    success: summarizeCompletedBatch({ state: finalState.success, run, firstStatus: "completed", staleCas: staleError }),
    reconciliation: finalState,
  };
}

function assertMutationUserErrors(payload, aliases) {
  const errors = aliases.flatMap((alias) => (payload.data?.[alias]?.userErrors ?? []).map((error) => ({ alias, ...error })));
  if (errors.length > 0) throw new Error(`Shopify batch mutation failed: ${JSON.stringify(errors)}`);
}

function hasObservedTargetState(state) {
  return state.definition !== null || state.revisions.length > 0 || state.snapshot_checksum !== null
    || state.projection_checksum !== null || state.active_revision_id !== null || state.publication !== null;
}

function isCompletedImportState({ plan, state, run }) {
  const record = plan.records[0];
  return state.ledger?.state === "completed"
    && state.ledger.source_identity === record.source_identity
    && state.ledger.source_fingerprint === record.source_fingerprint
    && state.ledger.target_bundle_definition_id === record.target.bundle_definition_id
    && state.ledger.target_fingerprint === record.target_fingerprint
    && state.ledger.target_result?.publication_id === run.publicationId;
}

function isCompletedObservedTargetState(state) {
  const target = state.ledger?.target_result;
  return target?.success === true
    && state.definition?.active_revision_id === target.revision_id
    && state.revisions.some((revision) => revision.revision_id === target.revision_id && revision.status === "published")
    && state.snapshot_checksum === target.snapshot_checksum
    && state.projection_checksum === target.projection_checksum
    && state.active_revision_id === target.revision_id
    && state.publication?.result?.success === true
    && state.publication.publication_id === target.publication_id;
}

async function rejectLedgerStaleCas({ executeGraphql, shopId, record, value, compareDigest }) {
  const metafields = DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS.metafields;
  const stale = await executeGraphql(`#graphql
    mutation DevPrebuiltImportRejectStaleCas($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { value compareDigest }
        userErrors { field message code }
      }
    }`, { variables: { metafields: [{
    ownerId: shopId,
    namespace: metafields.namespace,
    key: ledgerKey(record.source_identity),
    type: "json",
    value: JSON.stringify(value),
    compareDigest,
  }] } });
  const error = stale.data?.metafieldsSet?.userErrors?.find((item) => ["INVALID_COMPARE_DIGEST", "STALE_OBJECT"].includes(item.code));
  return error?.code ?? "NO_WRITE_CONFIRMED_BY_READBACK";
}

function isExactTargetState({ state, compiled, publication }) {
  return sameJson(state.definition, compiled.definition)
    && state.revisions.some((revision) => revision.revision_id === compiled.revision.revision_id && revision.status === "published")
    && state.snapshot_checksum === compiled.snapshot.checksum
    && state.projection_checksum === compiled.expand_projection.checksum
    && state.active_revision_id === compiled.revision.revision_id
    && sameJson(state.publication, publication);
}

function summarizeCompletedBatch({ state, run, firstStatus, staleCas }) {
  return {
    first_status: firstStatus,
    exact_retry: firstStatus === "already_completed" ? "already_completed" : "pending_second_invocation",
    definition_id: run.definitionId,
    revision_id: run.revisionId,
    publication_id: run.publicationId,
    snapshot_checksum: state.snapshot_checksum,
    projection_checksum: state.projection_checksum,
    stale_cas_error: staleCas,
  };
}

function verifyObservedPartialRecovery({ plan, state }) {
  if (state.ledger?.state !== "failed") throw new Error("partial rehearsal ledger is not failed");
  const recovery = assessPrebuiltBundleImportRecovery({ plan, ledger_records: [state.ledger] });
  if (recovery.summary.requires_target_reconciliation !== 1
    || state.definition?.active_revision_id !== null
    || state.snapshot_checksum !== null
    || state.projection_checksum !== null
    || state.active_revision_id !== null) {
    throw new Error("partial rehearsal durable boundary does not match target-reconciliation evidence");
  }
  return {
    execution_status: "existing_failed",
    ledger_state: state.ledger.state,
    recovery_status: recovery.records[0].status,
    retry_blocked: true,
    completed_boundary: state.revisions.length === 0 ? ["definition_staged"] : ["definition_staged", "revision_written"],
    definition_id: plan.records[0].target.bundle_definition_id,
    revision_ids: state.revisions.map((revision) => revision.revision_id),
  };
}

function sameJson(left, right) {
  return stableJson(left) === stableJson(right);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function runSuccessfulImport({ execute: executeGraphql, persistence, packageValue, plan }) {
  const app = createDevShopifyBundleAdminService({
    admin: { graphql: (query, options) => executeGraphql(query, options) },
    appClientId: DEV_SHOPIFY_APP_CLIENT_ID,
    persistenceBindings: DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS,
    prebuiltImportExecutionEnabled: true,
  });
  const input = {
    import_package: packageValue,
    confirmation_token: plan.confirmation_token,
    confirmation: `IMPORT:${plan.import_id}:${plan.confirmation_token}`,
  };
  const first = await app.executePrebuiltBundleImport(input);
  if (first.failed !== 0 || (first.completed !== 1 && first.already_completed !== 1)) {
    throw new Error(`successful rehearsal import did not complete: ${JSON.stringify(first)}`);
  }
  const retry = await app.executePrebuiltBundleImport(input);
  if (retry.already_completed !== 1 || retry.failed !== 0) {
    throw new Error(`successful rehearsal retry was not idempotent: ${JSON.stringify(retry)}`);
  }

  const record = plan.records[0];
  const ledger = await persistence.readPrebuiltImportLedger(record.source_identity);
  if (ledger?.state !== "completed" || !ledger.target_result?.success) {
    throw new Error("successful rehearsal ledger was not durably completed");
  }
  const target = ledger.target_result;
  const [definition, revision, snapshot, projection, activeRevision, audit] = await Promise.all([
    persistence.readBundleDefinition(target.bundle_definition_id),
    persistence.readRevision(target.revision_id),
    persistence.readRuntimeSnapshot(target.bundle_definition_id),
    persistence.readPrebuiltExpandProjection(target.bundle_definition_id),
    persistence.readActiveRevisionId(target.bundle_definition_id),
    persistence.readPublicationById(target.publication_id),
  ]);
  if (definition.active_revision_id !== target.revision_id
    || revision.status !== "published"
    || snapshot.checksum !== target.snapshot_checksum
    || projection.checksum !== target.projection_checksum
    || activeRevision !== target.revision_id
    || audit?.result?.success !== true) {
    throw new Error("successful rehearsal durable read-back parity failed");
  }
  const staleCas = await assertLedgerStaleCasRejected({ execute: executeGraphql, record });
  return {
    first_status: first.completed === 1 ? "completed" : "already_completed",
    exact_retry: "already_completed",
    definition_id: target.bundle_definition_id,
    revision_id: target.revision_id,
    publication_id: target.publication_id,
    snapshot_checksum: target.snapshot_checksum,
    projection_checksum: target.projection_checksum,
    stale_cas_error: staleCas,
  };
}

async function runPartialRecovery({ persistence, packageValue, plan }) {
  const record = plan.records[0];
  const ledger = createShopifyPrebuiltBundleImportLedger({ persistence });
  let existing = await ledger.read(record.source_identity);
  let executionStatus = "existing_failed";
  if (existing === null) {
    const failingPersistence = {
      ...persistence,
      async writeRuntimeSnapshot() {
        throw new BundlePersistenceError("WRITE_FAILED", "injected rehearsal failure before Snapshot write");
      },
    };
    const ids = [
      DEV_PREBUILT_IMPORT_REHEARSAL_RUNS.partial.revisionId,
      DEV_PREBUILT_IMPORT_REHEARSAL_RUNS.partial.publicationId,
    ];
    const createTarget = createPrebuiltBundleImportTargetWriter({
      persistence: failingPersistence,
      pilot_scope: packageValue.pilot_scope,
      id_factory: () => ids.shift(),
      now: () => "2026-07-20T00:00:00Z",
      created_by: "dev-prebuilt-import-rehearsal",
    });
    const result = await executeConfirmedPrebuiltBundleImport({
      plan,
      confirmation_token: plan.confirmation_token,
      ledger,
      create_target: createTarget,
      now: () => "2026-07-20T00:00:00Z",
    });
    if (result.failed !== 1) throw new Error("partial rehearsal did not record the injected target failure");
    executionStatus = "failed_as_injected";
    existing = await ledger.read(record.source_identity);
  }
  if (existing?.state !== "failed") throw new Error("partial rehearsal ledger is not failed");

  const recovery = assessPrebuiltBundleImportRecovery({ plan, ledger_records: [existing] });
  if (recovery.summary.requires_target_reconciliation !== 1) {
    throw new Error("partial rehearsal was not routed to target reconciliation");
  }
  await expectRetryConflict(() => executeConfirmedPrebuiltBundleImport({
    plan,
    confirmation_token: plan.confirmation_token,
    ledger,
    create_target: async () => { throw new Error("must not execute"); },
  }));
  const definition = await persistence.readBundleDefinition(record.target.bundle_definition_id);
  const revisions = await persistence.listRevisionsByDefinition(record.target.bundle_definition_id);
  const snapshot = await persistence.readRuntimeSnapshot(record.target.bundle_definition_id);
  if (definition.active_revision_id !== null || snapshot !== null) {
    throw new Error("partial rehearsal durable boundary advanced past its failed ledger evidence");
  }
  return {
    execution_status: executionStatus,
    ledger_state: existing.state,
    recovery_status: recovery.records[0].status,
    retry_blocked: true,
    completed_boundary: revisions.length === 0 ? ["definition_staged"] : ["definition_staged", "revision_written"],
    definition_id: record.target.bundle_definition_id,
    revision_ids: revisions.map((revision) => revision.revision_id),
  };
}

async function assertLedgerStaleCasRejected({ execute: executeGraphql, record }) {
  const namespace = DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS.metafields.namespace;
  const key = ledgerKey(record.source_identity);
  const before = await executeGraphql(`#graphql
    query DevPrebuiltImportLedgerRead($namespace: String!, $key: String!) {
      shop { id metafield(namespace: $namespace, key: $key) { value jsonValue compareDigest } }
    }`, { variables: { namespace, key } });
  const metafield = before.data?.shop?.metafield;
  if (!metafield?.compareDigest) throw new Error("completed rehearsal ledger metafield is missing");
  const stale = await executeGraphql(`#graphql
    mutation DevPrebuiltImportLedgerStaleCas($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { value compareDigest }
        userErrors { field message code }
      }
    }`, { variables: { metafields: [{
      ownerId: before.data.shop.id,
      namespace,
      key,
      type: "json",
      value: metafield.value,
      compareDigest: "0000000000000000000000000000000000000000000000000000000000000000",
    }] } });
  const error = stale.data?.metafieldsSet?.userErrors?.find((item) => item.code === "INVALID_COMPARE_DIGEST");
  if (!error) throw new Error("Shopify did not reject the stale rehearsal ledger CAS");
  const after = await executeGraphql(`#graphql
    query DevPrebuiltImportLedgerReadAfterStale($namespace: String!, $key: String!) {
      shop { metafield(namespace: $namespace, key: $key) { value compareDigest } }
    }`, { variables: { namespace, key } });
  if (after.data?.shop?.metafield?.value !== metafield.value
    || after.data?.shop?.metafield?.compareDigest !== metafield.compareDigest) {
    throw new Error("stale rehearsal ledger CAS changed durable state");
  }
  return error.code;
}

async function readCandidateProducts(executeGraphql) {
  const payload = await executeGraphql(`#graphql
    query DevPrebuiltImportCandidateProducts {
      shop { id }
      products(first: 100, sortKey: ID) {
        nodes {
          id
          title
          handle
          status
          variants(first: 10) { nodes { id title sku } }
        }
      }
    }`);
  const shopId = payload.data?.shop?.id;
  if (typeof shopId !== "string" || shopId === "") throw new Error("Shopify candidate query returned no Shop ID");
  return { products: payload.data?.products?.nodes ?? [], shopId };
}

function selectRehearsalParents({ products, definitions }) {
  const excludedProducts = excludedComponentProductGids();
  const boundVariants = new Set(definitions.map((definition) => definition.parent_binding?.variant_gid));
  const selected = {};
  const usedVariants = new Set();
  for (const [name, run] of Object.entries(DEV_PREBUILT_IMPORT_REHEARSAL_RUNS)) {
    const existing = definitions.find((definition) => definition.bundle_definition_id === run.definitionId);
    let product;
    let variant;
    if (existing) {
      product = products.find((candidate) => candidate.id === existing.parent_binding.product_gid);
      variant = product?.variants?.nodes?.find((candidate) => candidate.id === existing.parent_binding.variant_gid);
    } else {
      product = products.find((candidate) => {
        const firstVariant = candidate.variants?.nodes?.find((item) => item.sku?.trim());
        return candidate.status === "ACTIVE"
          && !excludedProducts.has(candidate.id)
          && firstVariant
          && !boundVariants.has(firstVariant.id)
          && !usedVariants.has(firstVariant.id);
      });
      variant = product?.variants?.nodes?.find((item) => item.sku?.trim());
    }
    if (!product || !variant) throw new Error(`no safe existing Shopify parent is available for ${name} rehearsal`);
    usedVariants.add(variant.id);
    selected[name] = {
      product_gid: product.id,
      variant_gid: variant.id,
      sku: variant.sku,
      title: `${product.title} - ${variant.title}`,
      template_handle: product.handle,
    };
  }
  if (selected.success.variant_gid === selected.partial.variant_gid) {
    throw new Error("successful and partial rehearsals must use different parent Variants");
  }
  return selected;
}

function requireReadyPlan(packageValue, definitions) {
  const result = createPrebuiltBundleImportPlanFromPackage(packageValue, {
    existing_parent_variant_gids: definitions.map((definition) => definition.parent_binding.variant_gid),
    existing_parent_bindings: definitions.map((definition) => ({
      bundle_definition_id: definition.bundle_definition_id,
      product_gid: definition.parent_binding.product_gid,
      variant_gid: definition.parent_binding.variant_gid,
    })),
  });
  if (!result.ok || result.plan.summary.ready_for_confirmation !== 1) {
    throw new Error(`pre-built import rehearsal plan is not ready: ${JSON.stringify(result)}`);
  }
  return result.plan;
}

async function expectRetryConflict(run) {
  try {
    await run();
  } catch (error) {
    if (error?.code === "RETRY_CONFLICT") return;
    throw error;
  }
  throw new Error("failed import retry did not stop with RETRY_CONFLICT");
}

function ledgerKey(sourceIdentity) {
  const digest = createHash("sha256").update(sourceIdentity, "utf8").digest("hex").slice(0, 32);
  return `${DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS.metafields.prebuiltImportLedgerKeyPrefix}${digest}`;
}

function summarizePlan(plan) {
  return {
    import_id: plan.import_id,
    confirmation_token: plan.confirmation_token,
    target_bundle_definition_id: plan.records[0].target.bundle_definition_id,
    target_fingerprint: plan.records[0].target_fingerprint,
    ready_for_confirmation: plan.summary.ready_for_confirmation,
  };
}

function parseEnvFile(value) {
  return Object.fromEntries(value.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || !trimmed.includes("=")) return [];
    const separator = trimmed.indexOf("=");
    return [[trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim()]];
  }));
}
