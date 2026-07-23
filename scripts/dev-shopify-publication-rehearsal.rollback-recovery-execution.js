import { createDevPublicationRollbackRecovery } from "./dev-shopify-publication-rehearsal.rollback-recovery.js";

export async function executeDevPublicationRollbackRecovery({ readRemote, persistence } = {}) {
  assertDependencies({ readRemote, persistence });
  const plan = createDevPublicationRollbackRecovery(await readRemote());
  if (plan.status === "rollback_recovered") {
    return { status: "rollback_recovered", completed_steps: [] };
  }
  if (plan.status !== "ready_to_complete_rollback") {
    throw new Error(`rollback recovery cannot continue from ${plan.status}`);
  }
  const steps = Object.entries(plan.steps).filter(([, enabled]) => enabled);
  if (steps.length !== 1) {
    throw new Error("rollback recovery must contain exactly one approved mutation step");
  }
  const [step] = steps[0];
  if (step === "write_baseline_revision" || step === "write_candidate_revision") {
    const revisionId = step === "write_baseline_revision"
      ? plan.identifiers.baselineRevisionId
      : plan.identifiers.candidateRevisionId;
    const revision = plan.target.domain.revisions.find((candidate) => candidate.revision_id === revisionId);
    await persistence.writeRevision({ revision });
    return verifyOneStep({
      readRemote,
      expectedStatus: "ready_to_complete_rollback",
      completedStep: step === "write_baseline_revision"
        ? "baseline_revision_persisted"
        : "candidate_revision_persisted",
    });
  }
  if (step === "write_definition") {
    await persistence.writeBundleDefinition({ definition: plan.target.domain.definition });
    return verifyOneStep({
      readRemote,
      expectedStatus: "ready_to_complete_rollback",
      completedStep: "definition_persisted",
    });
  }
  if (step === "write_publication") {
    await persistence.writePublicationRecord({
      publication_id: plan.identifiers.rollbackPublicationId,
      record: plan.target.publication,
    });
    return verifyOneStep({
      readRemote,
      expectedStatus: "rollback_recovered",
      completedStep: "publication_recorded",
    });
  }
  throw new Error(`rollback recovery contains an unsupported mutation step: ${step}`);
}

async function verifyOneStep({ readRemote, expectedStatus, completedStep }) {
  const verified = createDevPublicationRollbackRecovery(await readRemote());
  if (verified.status !== expectedStatus) {
    throw new Error(`rollback recovery read-back ended at ${verified.status}`);
  }
  return { status: verified.status, completed_steps: [completedStep] };
}

function assertDependencies({ readRemote, persistence }) {
  if (typeof readRemote !== "function") throw new Error("rollback recovery requires readRemote");
  for (const method of ["writeRevision", "writeBundleDefinition", "writePublicationRecord"]) {
    if (typeof persistence?.[method] !== "function") {
      throw new Error(`rollback recovery persistence method is missing: ${method}`);
    }
  }
}
