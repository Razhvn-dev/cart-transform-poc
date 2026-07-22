import { createHash } from "node:crypto";

import { calculateStableValueChecksum } from "../extensions/master-kit-expand/src/config/bundle-runtime.checksum.js";
import { compilePrebuiltBundleImportTarget } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.target.js";

export const DEV_CATALOG_TECHNICAL_BATCH_EXECUTION_MANIFEST_SCHEMA_VERSION =
  "dev_catalog_technical_batch_execution_manifest.v1";

export function createDevCatalogTechnicalBatchExecutionManifest({ importReview, drafts, collisions, scope } = {}) {
  assertInputs(importReview, drafts, collisions, scope);
  const draftsByDefinition = new Map(drafts.records
    .filter((record) => record.status === "draft_ready")
    .map((record) => [record.draft.definition.bundle_definition_id, record]));
  const records = importReview.plan.records.map((record) => {
    const draftRecord = draftsByDefinition.get(record.target.bundle_definition_id);
    if (!draftRecord) throw new Error(`draft not found for ${record.target.bundle_definition_id}`);
    const revisionId = draftRecord.draft.revision.revision_id;
    const publicationId = stableUuid(`${scope.batch_id}:${record.source_identity}:publication`);
    const compiled = compilePrebuiltBundleImportTarget({
      record,
      pilot_scope: importReview.import_package.pilot_scope,
      revision_id: revisionId,
      created_at: scope.draft_created_at,
      created_by: scope.draft_created_by,
    });
    if (compiled.status !== "ready") throw new Error(`target compile failed for ${record.source_identity}: ${compiled.reason}`);
    if (compiled.revision.configuration.status !== "active") {
      throw new Error(`published target configuration is not active for ${record.source_identity}`);
    }
    return {
      source_identity: record.source_identity,
      target_fingerprint: record.target_fingerprint,
      bundle_definition_id: compiled.definition.bundle_definition_id,
      revision_id: revisionId,
      publication_id: publicationId,
      parent_product_gid: compiled.definition.parent_binding.product_gid,
      parent_variant_gid: compiled.definition.parent_binding.variant_gid,
      snapshot_checksum: compiled.snapshot.checksum,
      projection_checksum: compiled.expand_projection.checksum,
      execution_steps: [
        "ledger_pending_cas",
        "definition_stage_write_readback",
        "revision_write_readback",
        "snapshot_write_readback",
        "projection_write_readback",
        "active_pointer_cas_readback",
        "definition_activation_readback",
        "publication_record_write_readback",
        "ledger_completed_cas",
      ],
      retry_policy: "RECONCILE_THEN_EXACT_RESUME",
    };
  });
  const body = {
    schema_version: DEV_CATALOG_TECHNICAL_BATCH_EXECUTION_MANIFEST_SCHEMA_VERSION,
    mode: "development_apply_manifest",
    app: "cart-transform-poc-dev",
    app_config: "shopify.app.dev.toml",
    store_domain: "huang-mvqquz1p.myshopify.com",
    batch_id: scope.batch_id,
    import_id: importReview.plan.import_id,
    package_fingerprint: importReview.package_fingerprint,
    plan_confirmation_token: importReview.plan.confirmation_token,
    exact_apply_confirmation: `APPLY_DEV_BATCH_${importReview.plan.confirmation_token}`,
    records,
    remote_state_precondition: "COLLISION_READBACK_CLEAN",
    mutation_retry_policy: "NEVER_BLIND_RETRY_AFTER_TRANSPORT_ERROR",
    shopify_writes_performed: false,
  };
  return { ...body, checksum: calculateStableValueChecksum(body) };
}

function assertInputs(importReview, drafts, collisions, scope) {
  if (importReview?.batch_id !== scope?.batch_id || drafts?.batch_id !== scope?.batch_id || collisions?.batch_id !== scope?.batch_id) {
    throw new Error("execution evidence batch mismatch");
  }
  if (importReview.plan?.summary?.rejected !== 0 || importReview.plan?.summary?.needs_review !== 0) {
    throw new Error("import plan is not fully ready");
  }
  if (collisions.summary?.blocked !== 0) throw new Error("collision readback is not clean");
}

function stableUuid(seed) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
