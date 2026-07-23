import { createDevPublicationCandidateRecovery } from "./dev-shopify-publication-rehearsal.candidate-recovery.js";
import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";

export async function executeDevPublicationCandidateRecovery({ readRemote, persistence } = {}) {
  assertDependencies({ readRemote, persistence });
  const plan = createDevPublicationCandidateRecovery(await readRemote());
  if (plan.status === "candidate_recovered") {
    return Object.freeze({ status: "candidate_recovered", completed_steps: Object.freeze([]) });
  }
  if (plan.status === "ready_to_publish") {
    const candidateSnapshot = compileRuntimeSnapshot(plan.candidate_draft.configuration);
    const baselineRevision = plan.target.domain.revisions.find(
      (revision) => revision.revision_id === plan.identifiers.baselineRevisionId,
    );
    const baselineSnapshot = compileRuntimeSnapshot(baselineRevision.configuration);
    await persistence.writeRuntimeSnapshot({
      bundle_definition_id: plan.identifiers.bundleDefinitionId,
      target_revision_id: plan.identifiers.candidateRevisionId,
      snapshot: candidateSnapshot,
      expected_previous_snapshot_checksum: baselineSnapshot.checksum,
      target_snapshot_checksum: candidateSnapshot.checksum,
      publication_id: plan.identifiers.candidatePublicationId,
    });
    return verifyOneStep({
      readRemote,
      expectedStatus: "ready_to_complete_candidate",
      completedStep: "snapshot_written",
    });
  }
  if (plan.status !== "ready_to_complete_candidate") {
    throw new Error(`candidate recovery cannot continue from ${plan.status}`);
  }
  const steps = Object.entries(plan.steps).filter(([, enabled]) => enabled);
  if (steps.length !== 1) {
    throw new Error("candidate recovery must contain exactly one approved mutation step");
  }
  const [step] = steps[0];
  if (step === "write_active_pointer") {
    await persistence.compareAndSetActiveRevision({
      bundle_definition_id: plan.identifiers.bundleDefinitionId,
      expected_active_revision_id: plan.identifiers.baselineRevisionId,
      target_revision_id: plan.identifiers.candidateRevisionId,
      publication_id: plan.identifiers.candidatePublicationId,
    });
    return verifyOneStep({
      readRemote,
      expectedStatus: "ready_to_complete_candidate",
      completedStep: "active_pointer_updated",
    });
  }
  if (step === "write_baseline_revision" || step === "write_candidate_revision") {
    const revisionId = step === "write_baseline_revision"
      ? plan.identifiers.baselineRevisionId
      : plan.identifiers.candidateRevisionId;
    const revision = plan.target.domain.revisions.find((candidate) => candidate.revision_id === revisionId);
    await persistence.writeRevision({ revision });
    return verifyOneStep({
      readRemote,
      expectedStatus: "ready_to_complete_candidate",
      completedStep: step === "write_baseline_revision"
        ? "baseline_revision_persisted"
        : "candidate_revision_persisted",
    });
  }
  if (step === "write_definition") {
    await persistence.writeBundleDefinition({ definition: plan.target.domain.definition });
    return verifyOneStep({
      readRemote,
      expectedStatus: "ready_to_complete_candidate",
      completedStep: "definition_persisted",
    });
  }
  if (step === "write_publication") {
    await persistence.writePublicationRecord({
      publication_id: plan.identifiers.candidatePublicationId,
      record: plan.target.publication,
    });
    return verifyOneStep({
      readRemote,
      expectedStatus: "candidate_recovered",
      completedStep: "publication_recorded",
    });
  }
  throw new Error(`candidate recovery contains an unsupported mutation step: ${step}`);
}

async function verifyOneStep({ readRemote, expectedStatus, completedStep }) {
  const verified = createDevPublicationCandidateRecovery(await readRemote());
  if (verified.status !== expectedStatus) {
    throw new Error(`candidate recovery read-back ended at ${verified.status}`);
  }
  return Object.freeze({
    status: verified.status,
    completed_steps: Object.freeze([completedStep]),
  });
}

function assertDependencies({ readRemote, persistence }) {
  if (typeof readRemote !== "function") throw new Error("candidate recovery requires readRemote");
  for (const method of [
    "compareAndSetActiveRevision",
    "writeRuntimeSnapshot",
    "writeRevision",
    "writeBundleDefinition",
    "writePublicationRecord",
  ]) {
    if (typeof persistence?.[method] !== "function") {
      throw new Error(`candidate recovery persistence method is missing: ${method}`);
    }
  }
}
