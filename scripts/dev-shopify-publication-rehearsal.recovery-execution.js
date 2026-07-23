import { createDevPublicationRehearsalRecovery } from "./dev-shopify-publication-rehearsal.recovery.js";

export async function executeDevPublicationBaselineRecovery({ readRemote, persistence } = {}) {
  assertDependencies({ readRemote, persistence });
  const plan = createDevPublicationRehearsalRecovery(await readRemote());
  if (plan.status === "already_recovered") {
    return { status: "baseline_recovered", completed_steps: [] };
  }
  const steps = Object.entries(plan.steps).filter(([, enabled]) => enabled);
  if (steps.length !== 1) {
    throw new Error("baseline recovery must contain exactly one approved mutation step");
  }
  const [step] = steps[0];
  if (step === "write_revision") {
    await persistence.writeRevision({ revision: plan.target.revision });
    return verifyOneStep({ readRemote, expectedStep: "write_definition", completedStep: "baseline_revision_persisted" });
  }
  if (step === "write_definition") {
    await persistence.writeBundleDefinition({ definition: plan.target.definition });
    return verifyOneStep({ readRemote, expectedStep: "write_publication", completedStep: "definition_persisted" });
  }
  if (step === "write_publication") {
    await persistence.writePublicationRecord({
      publication_id: plan.identifiers.baselinePublicationId,
      record: plan.target.publication,
    });
    const verified = createDevPublicationRehearsalRecovery(await readRemote());
    if (verified.status !== "already_recovered") {
      throw new Error(`baseline recovery read-back ended at ${verified.status}`);
    }
    return { status: "baseline_recovered", completed_steps: ["publication_recorded"] };
  }
  throw new Error(`baseline recovery contains an unsupported mutation step: ${step}`);
}

async function verifyOneStep({ readRemote, expectedStep, completedStep }) {
  const verified = createDevPublicationRehearsalRecovery(await readRemote());
  if (verified.status !== "ready_to_recover" || verified.steps[expectedStep] !== true) {
    throw new Error("baseline recovery read-back did not reach the approved next state");
  }
  return { status: verified.status, completed_steps: [completedStep] };
}

function assertDependencies({ readRemote, persistence }) {
  if (typeof readRemote !== "function") throw new Error("baseline recovery requires readRemote");
  for (const method of ["writeRevision", "writeBundleDefinition", "writePublicationRecord"]) {
    if (typeof persistence?.[method] !== "function") {
      throw new Error(`baseline recovery persistence method is missing: ${method}`);
    }
  }
}
