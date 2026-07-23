import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { createDevPublicationRollbackRecovery } from "./dev-shopify-publication-rehearsal.rollback-recovery.js";

export async function executeDevPublicationRollbackStaging({ readRemote, persistence } = {}) {
  assertDependencies({ readRemote, persistence });
  const plan = createDevPublicationRollbackRecovery(await readRemote());
  if (plan.status === "ready_to_stage_rollback_snapshot") {
    const candidateRevision = plan.target.domain.revisions.find(
      (revision) => revision.revision_id === plan.identifiers.candidateRevisionId,
    );
    const candidateSnapshot = compileRuntimeSnapshot(candidateRevision.configuration);
    await persistence.writeRuntimeSnapshot({
      bundle_definition_id: plan.identifiers.bundleDefinitionId,
      target_revision_id: plan.identifiers.baselineRevisionId,
      snapshot: plan.target.snapshot,
      expected_previous_snapshot_checksum: candidateSnapshot.checksum,
      target_snapshot_checksum: plan.target.snapshot.checksum,
      publication_id: plan.identifiers.rollbackPublicationId,
    });
    return verify(await readRemote(), "ready_to_stage_rollback_pointer", "snapshot_written");
  }
  if (plan.status === "ready_to_stage_rollback_pointer") {
    await persistence.compareAndSetActiveRevision({
      bundle_definition_id: plan.identifiers.bundleDefinitionId,
      expected_active_revision_id: plan.identifiers.candidateRevisionId,
      target_revision_id: plan.identifiers.baselineRevisionId,
      publication_id: plan.identifiers.rollbackPublicationId,
    });
    return verify(await readRemote(), "ready_to_complete_rollback", "active_pointer_updated");
  }
  throw new Error(`rollback staging cannot continue from ${plan.status}`);
}

function verify(remote, expectedStatus, completedStep) {
  const verified = createDevPublicationRollbackRecovery(remote);
  if (verified.status !== expectedStatus) {
    throw new Error(`rollback staging read-back ended at ${verified.status}`);
  }
  return { status: verified.status, completed_steps: [completedStep] };
}

function assertDependencies({ readRemote, persistence }) {
  if (typeof readRemote !== "function") throw new Error("rollback staging requires readRemote");
  for (const method of ["writeRuntimeSnapshot", "compareAndSetActiveRevision"]) {
    if (typeof persistence?.[method] !== "function") {
      throw new Error(`rollback staging persistence method is missing: ${method}`);
    }
  }
}
