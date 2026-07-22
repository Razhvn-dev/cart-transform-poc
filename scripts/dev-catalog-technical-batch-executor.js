import { calculateStableValueChecksum } from "../extensions/master-kit-expand/src/config/bundle-runtime.checksum.js";
import { compilePrebuiltBundleImportTarget } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.target.js";
import { persistPrebuiltBundleImportTarget } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.target-persistence.js";
import { DEV_SHOPIFY_APP_CLIENT_ID } from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import { DEV_CATALOG_TECHNICAL_BATCH_EXECUTION_MANIFEST_SCHEMA_VERSION } from "./dev-catalog-technical-batch-execution-manifest.js";

export const DEV_CATALOG_TECHNICAL_BATCH_TARGET = Object.freeze({
  app: "cart-transform-poc-dev",
  appConfig: "shopify.app.dev.toml",
  store: "huang-mvqquz1p.myshopify.com",
  clientId: DEV_SHOPIFY_APP_CLIENT_ID,
});

export async function executeDevCatalogTechnicalBatch({
  importReview,
  manifest,
  persistence,
  confirmation,
  apply = false,
  sourceIdentity = null,
  reconciliationEvidence = null,
} = {}) {
  assertExecutionInputs({ importReview, manifest, persistence, confirmation, apply });
  const manifestBySource = new Map(manifest.records.map((record) => [record.source_identity, record]));
  const selected = importReview.plan.records.filter((record) => sourceIdentity === null || record.source_identity === sourceIdentity);
  if (selected.length === 0) throw new Error(`source identity is not present in reviewed plan: ${sourceIdentity}`);

  const results = [];
  let shopifyWritesPerformed = false;
  for (const record of selected) {
    const frozen = manifestBySource.get(record.source_identity);
    if (!frozen) throw new Error(`execution manifest record is missing: ${record.source_identity}`);
    const compiled = compileFrozenTarget({ record, frozen, importReview });
    const state = reconciliationEvidence === null
      ? await inspectDevCatalogTechnicalBatchTarget({
        persistence,
        compiled,
        frozen,
        importId: manifest.import_id,
        sourceFingerprint: record.source_fingerprint,
        targetFingerprint: record.target_fingerprint,
      })
      : stateFromReconciliationEvidence({
        evidence: reconciliationEvidence,
        manifest,
        record,
        frozen,
        compiled,
      });
    if (!apply) {
      results.push({ source_identity: record.source_identity, status: state.status, state });
      continue;
    }
    if (state.ledger?.state === "completed") {
      assertCompleteState(state, record.source_identity);
      results.push({ source_identity: record.source_identity, status: "already_completed", state });
      continue;
    }

    shopifyWritesPerformed = true;

    const at = state.ledger?.created_at ?? compiled.revision.created_at;
    const pending = state.ledger ?? createLedgerRecord({
      manifest,
      record,
      state: "pending",
      createdAt: at,
      updatedAt: at,
    });
    if (state.ledger === null) await persistence.writePrebuiltImportLedger(pending);

    const targetResult = await persistPrebuiltBundleImportTarget({
      compiled_target: compiled,
      import_id: manifest.import_id,
      publication_id: frozen.publication_id,
      source_identity: record.source_identity,
      source_fingerprint: record.source_fingerprint,
      target_fingerprint: record.target_fingerprint,
      at,
    }, { persistence });
    const completed = {
      ...pending,
      state: "completed",
      updated_at: at,
      completed_at: at,
      target_result: structuredClone(targetResult),
    };
    await persistence.writePrebuiltImportLedger(completed);
    const verified = await inspectDevCatalogTechnicalBatchTarget({
      persistence,
      compiled,
      frozen,
      importId: manifest.import_id,
      sourceFingerprint: record.source_fingerprint,
      targetFingerprint: record.target_fingerprint,
    });
    assertCompleteState(verified, record.source_identity);
    results.push({ source_identity: record.source_identity, status: "completed", state: verified });
  }
  return Object.freeze({
    mode: apply ? "development_apply" : "read_only_reconciliation",
    target: DEV_CATALOG_TECHNICAL_BATCH_TARGET,
    manifest_checksum: manifest.checksum,
    shopify_writes_performed: shopifyWritesPerformed,
    results: Object.freeze(results),
  });
}

export async function inspectDevCatalogTechnicalBatchTarget({
  persistence,
  compiled,
  frozen,
  importId,
  sourceFingerprint,
  targetFingerprint,
}) {
  const definitionId = frozen.bundle_definition_id;
  // Shopify CLI authentication state is process-scoped, so keep these reads
  // sequential. Session transport may be parallel-safe, but the safe shared
  // execution path must not start competing CLI subprocesses.
  const definition = await readOptional(() => persistence.readBundleDefinition(definitionId));
  const revision = await readOptional(() => persistence.readRevision(frozen.revision_id));
  const snapshot = await readOptional(() => persistence.readRuntimeSnapshot(definitionId));
  const projection = await readOptional(() => persistence.readPrebuiltExpandProjection(definitionId));
  const activeRevisionId = await readOptional(() => persistence.readActiveRevisionId(definitionId));
  const publication = await persistence.readPublicationById(frozen.publication_id);
  const ledger = await persistence.readPrebuiltImportLedger(compiled.assignment.source_identity);
  assertAllowed(definition, [{ ...compiled.definition, active_revision_id: null }, compiled.definition], "BundleDefinition");
  assertAllowed(revision, [compiled.revision], "BundleRevision");
  assertAllowed(snapshot, [compiled.snapshot], "Runtime Snapshot");
  assertAllowed(projection, [compiled.expand_projection], "expand projection");
  if (activeRevisionId !== null && activeRevisionId !== frozen.revision_id) throw new Error("active revision pointer drift");
  if (publication !== null && !(publication.import_id === importId
    && publication.publication_id === frozen.publication_id
    && publication.source_identity === compiled.assignment.source_identity
    && publication.source_fingerprint === sourceFingerprint
    && publication.target_fingerprint === targetFingerprint
    && publication.result?.success === true)) {
    throw new Error("PublicationRecord drift");
  }
  assertLedger(ledger, { importId, compiled, sourceFingerprint, targetFingerprint });
  const complete = same(definition, compiled.definition)
    && same(revision, compiled.revision)
    && same(snapshot, compiled.snapshot)
    && same(projection, compiled.expand_projection)
    && activeRevisionId === frozen.revision_id
    && publication?.result?.success === true;
  return Object.freeze({
    status: complete ? "durable_target_complete" : ledger === null ? "ready_to_apply" : "exact_resume_available",
    ledger,
    resources: Object.freeze({
      definition: definition === null ? "missing" : same(definition, compiled.definition) ? "active" : "staged",
      revision: revision === null ? "missing" : "exact",
      snapshot: snapshot === null ? "missing" : "exact",
      projection: projection === null ? "missing" : "exact",
      active_pointer: activeRevisionId === null ? "missing" : "exact",
      publication: publication === null ? "missing" : "exact",
    }),
  });
}

function compileFrozenTarget({ record, frozen, importReview }) {
  if (record.target.bundle_definition_id !== frozen.bundle_definition_id
    || record.target_fingerprint !== frozen.target_fingerprint) throw new Error(`manifest target drift: ${record.source_identity}`);
  const createdAt = record.target.configuration.audit?.published_at;
  const createdBy = record.target.configuration.audit?.published_by;
  const compiled = compilePrebuiltBundleImportTarget({
    record,
    pilot_scope: importReview.import_package.pilot_scope,
    revision_id: frozen.revision_id,
    created_at: createdAt,
    created_by: createdBy,
  });
  if (compiled.status !== "ready") throw new Error(`target compile failed: ${compiled.reason}`);
  if (compiled.snapshot.checksum !== frozen.snapshot_checksum
    || compiled.expand_projection.checksum !== frozen.projection_checksum) throw new Error(`manifest checksum drift: ${record.source_identity}`);
  return compiled;
}

function assertExecutionInputs({ importReview, manifest, persistence, confirmation, apply }) {
  if (manifest?.schema_version !== DEV_CATALOG_TECHNICAL_BATCH_EXECUTION_MANIFEST_SCHEMA_VERSION
    || manifest.mode !== "development_apply_manifest") throw new Error("current development execution manifest is required");
  const { checksum, ...body } = manifest;
  if (calculateStableValueChecksum(body) !== checksum) throw new Error("execution manifest checksum mismatch");
  if (manifest.app !== DEV_CATALOG_TECHNICAL_BATCH_TARGET.app
    || manifest.app_config !== DEV_CATALOG_TECHNICAL_BATCH_TARGET.appConfig
    || manifest.store_domain !== DEV_CATALOG_TECHNICAL_BATCH_TARGET.store) throw new Error("execution target is not the locked development app/store/config");
  if (manifest.import_id !== importReview?.plan?.import_id
    || manifest.package_fingerprint !== importReview?.package_fingerprint
    || manifest.plan_confirmation_token !== importReview?.plan?.confirmation_token) throw new Error("reviewed import evidence does not match execution manifest");
  if (manifest.remote_state_precondition !== "COLLISION_READBACK_CLEAN"
    || manifest.mutation_retry_policy !== "NEVER_BLIND_RETRY_AFTER_TRANSPORT_ERROR") throw new Error("execution safety policy mismatch");
  if (apply && confirmation !== manifest.exact_apply_confirmation) throw new Error("exact development apply confirmation is required");
  for (const method of ["readBundleDefinition", "readRevision", "readRuntimeSnapshot", "readPrebuiltExpandProjection", "readActiveRevisionId", "readPublicationById", "readPrebuiltImportLedger", "writePrebuiltImportLedger"]) {
    if (typeof persistence?.[method] !== "function") throw new Error(`persistence method is missing: ${method}`);
  }
}

function createLedgerRecord({ manifest, record, state, createdAt, updatedAt }) {
  return {
    schema_version: "prebuilt_bundle_import_ledger.v1",
    import_id: manifest.import_id,
    source_identity: record.source_identity,
    source_fingerprint: record.source_fingerprint,
    target_bundle_definition_id: record.target.bundle_definition_id,
    target_fingerprint: record.target_fingerprint,
    state,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function stateFromReconciliationEvidence({ evidence, manifest, record, frozen, compiled }) {
  if (evidence?.schema_version !== "dev_catalog_technical_batch_target_reconciliation.v1"
    || evidence.mode !== "read_only"
    || evidence.shopify_writes_performed !== false
    || evidence.manifest_checksum !== manifest.checksum
    || evidence.source_identity !== record.source_identity) throw new Error("trusted reconciliation evidence does not match execution record");
  if (!same(evidence.expected, {
    definition_id: frozen.bundle_definition_id,
    revision_id: frozen.revision_id,
    publication_id: frozen.publication_id,
    snapshot_checksum: frozen.snapshot_checksum,
    projection_checksum: frozen.projection_checksum,
  })) throw new Error("trusted reconciliation expected state drift");
  const capturedAt = Date.parse(evidence.captured_at);
  if (!Number.isFinite(capturedAt) || capturedAt > Date.now() || Date.now() - capturedAt > 15 * 60 * 1000) {
    throw new Error("trusted reconciliation evidence is stale");
  }
  const observed = evidence.observed;
  if (!observed) throw new Error("trusted reconciliation evidence has no observed state");
  assertAllowed(observed.definition, [{ ...compiled.definition, active_revision_id: null }, compiled.definition], "BundleDefinition");
  assertAllowed(observed.revision, [compiled.revision], "BundleRevision");
  assertAllowed(observed.snapshot, [compiled.snapshot], "Runtime Snapshot");
  assertAllowed(observed.projection, [compiled.expand_projection], "expand projection");
  if (observed.active_revision_id !== null && observed.active_revision_id !== frozen.revision_id) {
    throw new Error("active revision pointer drift");
  }
  if (observed.publication !== null && !(observed.publication.import_id === manifest.import_id
    && observed.publication.publication_id === frozen.publication_id
    && observed.publication.source_identity === record.source_identity
    && observed.publication.source_fingerprint === record.source_fingerprint
    && observed.publication.target_fingerprint === record.target_fingerprint
    && observed.publication.result?.success === true)) throw new Error("PublicationRecord drift");
  assertLedger(observed.ledger, {
    importId: manifest.import_id,
    compiled,
    sourceFingerprint: record.source_fingerprint,
    targetFingerprint: record.target_fingerprint,
  });
  const complete = same(observed.definition, compiled.definition)
    && same(observed.revision, compiled.revision)
    && same(observed.snapshot, compiled.snapshot)
    && same(observed.projection, compiled.expand_projection)
    && observed.active_revision_id === frozen.revision_id
    && observed.publication?.result?.success === true;
  return Object.freeze({
    status: complete ? "durable_target_complete" : observed.ledger === null ? "ready_to_apply" : "exact_resume_available",
    ledger: observed.ledger,
    resources: Object.freeze({
      definition: observed.definition === null ? "missing" : same(observed.definition, compiled.definition) ? "active" : "staged",
      revision: observed.revision === null ? "missing" : "exact",
      snapshot: observed.snapshot === null ? "missing" : "exact",
      projection: observed.projection === null ? "missing" : "exact",
      active_pointer: observed.active_revision_id === null ? "missing" : "exact",
      publication: observed.publication === null ? "missing" : "exact",
    }),
  });
}

function assertLedger(ledger, { importId, compiled, sourceFingerprint, targetFingerprint }) {
  if (ledger === null) return;
  if (ledger.import_id !== importId
    || ledger.source_identity !== compiled.assignment.source_identity
    || ledger.source_fingerprint !== sourceFingerprint
    || ledger.target_bundle_definition_id !== compiled.definition.bundle_definition_id
    || ledger.target_fingerprint !== targetFingerprint) throw new Error("pre-built import ledger drift");
  if (ledger.state === "failed") throw new Error("failed import ledger requires manual reconciliation");
  if (!["pending", "completed"].includes(ledger.state)) throw new Error("pre-built import ledger state is invalid");
}

function assertCompleteState(state, sourceIdentity) {
  if (state.status !== "durable_target_complete" || state.ledger?.state !== "completed") {
    throw new Error(`durable target verification is incomplete: ${sourceIdentity}`);
  }
}

async function readOptional(read) {
  try { return await read(); } catch (error) { if (error?.code === "NOT_FOUND") return null; throw error; }
}

function assertAllowed(existing, allowed, label) {
  if (existing !== null && !allowed.some((candidate) => same(existing, candidate))) throw new Error(`${label} drift`);
}

function same(left, right) {
  return stableJson(left) === stableJson(right);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? "null" : stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
