import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { UUID_REGEX } from "../extensions/master-kit-expand/src/config/bundle-config.schema.js";
import { generatePublicationPromotionEvidence } from "./generate-publication-promotion-evidence.mjs";

const PRIMARY_RUNTIME_SNAPSHOT_KEY = "bundle_runtime_snapshot_v1";
const PRIMARY_ACTIVE_REVISION_KEY = "active_revision_id_v1";
const LEGACY_RUNTIME_TEST_KEY = "bundle_runtime_snapshot_test";

export const DEV_PUBLICATION_REHEARSAL_TARGET = Object.freeze({
  appConfig: "shopify.app.dev.toml",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
});

// These keys are intentionally not read by the Function query or Admin UI.
// A real rehearsal must use these isolated carriers, never the current dev
// Snapshot/pointer keys that represent existing adapter-validation data.
export const DEV_PUBLICATION_REHEARSAL_BINDINGS = Object.freeze({
  namespace: "aces_dev",
  runtimeSnapshotKey: "bundle_runtime_snapshot_publication_rehearsal_v1",
  activeRevisionKey: "active_revision_id_publication_rehearsal_v1",
});

export class DevPublicationRehearsalPlanError extends Error {
  constructor(message) {
    super(message);
    this.name = "DevPublicationRehearsalPlanError";
  }
}

// This generates a local-only, reviewable plan. It performs no Admin API call,
// does not invoke Shopify CLI, and deliberately has no apply mode.
export function createDevPublicationRehearsalPlan({
  runId,
  baselineRevisionId,
  candidateRevisionId,
  baselinePublicationId,
  candidatePublicationId,
  baselineConfiguration,
  candidateConfiguration,
  bindings = DEV_PUBLICATION_REHEARSAL_BINDINGS,
} = {}) {
  assertUuid(runId, "runId");
  assertUuid(baselineRevisionId, "baselineRevisionId");
  assertUuid(candidateRevisionId, "candidateRevisionId");
  assertUuid(baselinePublicationId, "baselinePublicationId");
  assertUuid(candidatePublicationId, "candidatePublicationId");
  assertDistinct([runId, baselineRevisionId, candidateRevisionId, baselinePublicationId, candidatePublicationId]);
  assertIsolatedBindings(bindings);

  const baselineSnapshot = compileRuntimeSnapshot(baselineConfiguration);
  const candidateSnapshot = compileRuntimeSnapshot(candidateConfiguration);
  if (baselineSnapshot.parent.product_gid !== candidateSnapshot.parent.product_gid) {
    throw new DevPublicationRehearsalPlanError("baseline and candidate must use the same parent product");
  }
  if (baselineSnapshot.parent.variant_gid !== candidateSnapshot.parent.variant_gid) {
    throw new DevPublicationRehearsalPlanError("baseline and candidate must use the same parent variant");
  }
  if (baselineSnapshot.configuration_version >= candidateSnapshot.configuration_version) {
    throw new DevPublicationRehearsalPlanError("candidate configuration_version must be greater than baseline");
  }

  const plan = {
    schema_version: "dev_publication_rehearsal_plan.v1",
    mode: "local_only",
    target: DEV_PUBLICATION_REHEARSAL_TARGET,
    isolation: {
      bundle_definition_id: runId,
      bindings: structuredClone(bindings),
      forbidden_runtime_snapshot_keys: [PRIMARY_RUNTIME_SNAPSHOT_KEY, LEGACY_RUNTIME_TEST_KEY],
      forbidden_active_revision_keys: [PRIMARY_ACTIVE_REVISION_KEY],
      function_query_reads_rehearsal_keys: false,
    },
    records: {
      baseline_revision_id: baselineRevisionId,
      candidate_revision_id: candidateRevisionId,
      baseline_publication_id: baselinePublicationId,
      candidate_publication_id: candidatePublicationId,
    },
    baseline: snapshotPlan(baselineSnapshot, runId, baselineRevisionId),
    candidate: snapshotPlan(candidateSnapshot, runId, candidateRevisionId),
    operations: [
      "read_only_preflight",
      "explicitly_approved_isolated_baseline_seed",
      "read_back_baseline",
      "guarded_candidate_publication",
      "read_back_candidate",
      "idempotent_retry_check",
      "stale_cas_rejection_check",
      "guarded_rollback",
      "final_read_back",
    ],
  };

  assertDevPublicationRehearsalPlan(plan);
  return plan;
}

export function assertDevPublicationRehearsalPlan(plan) {
  if (plan?.schema_version !== "dev_publication_rehearsal_plan.v1" || plan?.mode !== "local_only") {
    throw new DevPublicationRehearsalPlanError("development publication rehearsal plan is invalid");
  }
  if (
    plan.target?.appConfig !== DEV_PUBLICATION_REHEARSAL_TARGET.appConfig ||
    plan.target?.store !== DEV_PUBLICATION_REHEARSAL_TARGET.store ||
    plan.target?.apiVersion !== DEV_PUBLICATION_REHEARSAL_TARGET.apiVersion
  ) {
    throw new DevPublicationRehearsalPlanError("development publication rehearsal target is invalid");
  }
  assertUuid(plan.isolation?.bundle_definition_id, "bundle_definition_id");
  assertIsolatedBindings(plan.isolation?.bindings);
  if (plan.isolation?.function_query_reads_rehearsal_keys !== false) {
    throw new DevPublicationRehearsalPlanError("Function must not read rehearsal metafields");
  }
  if (plan.isolation?.forbidden_runtime_snapshot_keys?.includes(plan.isolation.bindings.runtimeSnapshotKey)) {
    throw new DevPublicationRehearsalPlanError("rehearsal Snapshot key is not isolated");
  }
  if (plan.isolation?.forbidden_active_revision_keys?.includes(plan.isolation.bindings.activeRevisionKey)) {
    throw new DevPublicationRehearsalPlanError("rehearsal active revision key is not isolated");
  }
  return plan;
}

function snapshotPlan(snapshot, definitionId, revisionId) {
  return {
    revision_id: revisionId,
    configuration_version: snapshot.configuration_version,
    snapshot_checksum: snapshot.checksum,
    snapshot_byte_size: Buffer.byteLength(JSON.stringify(snapshot), "utf8"),
    promotion_evidence: generatePublicationPromotionEvidence({
      bundleDefinitionId: definitionId,
      revisionId,
      snapshot,
    }),
  };
}

function assertIsolatedBindings(bindings) {
  if (bindings?.namespace !== "aces_dev") {
    throw new DevPublicationRehearsalPlanError("development rehearsal must use the aces_dev namespace");
  }
  if (
    bindings.runtimeSnapshotKey === PRIMARY_RUNTIME_SNAPSHOT_KEY ||
    bindings.runtimeSnapshotKey === LEGACY_RUNTIME_TEST_KEY ||
    bindings.activeRevisionKey === PRIMARY_ACTIVE_REVISION_KEY
  ) {
    throw new DevPublicationRehearsalPlanError("primary or legacy dev metafield keys are prohibited for rehearsal");
  }
  if (
    typeof bindings.runtimeSnapshotKey !== "string" || !bindings.runtimeSnapshotKey.startsWith("bundle_runtime_snapshot_publication_rehearsal_") ||
    typeof bindings.activeRevisionKey !== "string" || !bindings.activeRevisionKey.startsWith("active_revision_id_publication_rehearsal_")
  ) {
    throw new DevPublicationRehearsalPlanError("rehearsal metafield keys must use the publication_rehearsal prefix");
  }
}

function assertUuid(value, field) {
  if (typeof value !== "string" || !UUID_REGEX.test(value)) {
    throw new DevPublicationRehearsalPlanError(`${field} must be a UUID`);
  }
}

function assertDistinct(values) {
  if (new Set(values).size !== values.length) {
    throw new DevPublicationRehearsalPlanError("rehearsal identifiers must be distinct");
  }
}
