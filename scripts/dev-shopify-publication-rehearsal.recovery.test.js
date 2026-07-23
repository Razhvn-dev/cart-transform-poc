import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { createDevPublicationRehearsalExecution } from "./dev-shopify-publication-rehearsal.execution.js";
import {
  DevPublicationRehearsalRecoveryError,
  createDevPublicationRehearsalRecovery,
} from "./dev-shopify-publication-rehearsal.recovery.js";

function partialRemote() {
  const execution = createDevPublicationRehearsalExecution();
  const snapshot = compileRuntimeSnapshot(execution.baselineRevision.configuration);
  return {
    definition: structuredClone(execution.definition),
    baselineRevision: structuredClone(execution.baselineRevision),
    candidateRevision: null,
    baselinePublication: null,
    candidatePublication: null,
    rollbackPublication: null,
    snapshot: { document: snapshot, compareDigest: "snapshot-digest" },
    activeRevision: { document: execution.identifiers.baselineRevisionId, compareDigest: "pointer-digest" },
  };
}

describe("development publication rehearsal recovery", () => {
  it("only completes the matching domain and audit records", () => {
    const recovery = createDevPublicationRehearsalRecovery(partialRemote());

    expect(recovery.status).toBe("ready_to_recover");
    expect(recovery.steps).toEqual({ write_revision: true });
    expect(recovery.target.revision.status).toBe("published");
    expect(recovery.target.definition.active_revision_id).toBe(recovery.identifiers.baselineRevisionId);
    expect(recovery.target.publication.result.warnings).toContain("recovered_partial_rehearsal");
  });

  it("advances through one-write revision and definition intermediate states", () => {
    const remote = partialRemote();
    let plan = createDevPublicationRehearsalRecovery(remote);
    remote.baselineRevision = plan.target.revision;

    plan = createDevPublicationRehearsalRecovery(remote);
    expect(plan.steps).toEqual({ write_definition: true });
    remote.definition = plan.target.definition;

    plan = createDevPublicationRehearsalRecovery(remote);
    expect(plan.steps).toEqual({ write_publication: true });
  });

  it("is idempotent only after the exact approved audit exists", () => {
    const remote = partialRemote();
    const first = createDevPublicationRehearsalRecovery(remote);
    remote.baselineRevision = first.target.revision;
    remote.definition = first.target.definition;
    remote.baselinePublication = first.target.publication;

    expect(createDevPublicationRehearsalRecovery(remote).status).toBe("already_recovered");
  });

  it("rejects any carrier drift before a mutation can be planned", () => {
    const remote = partialRemote();
    remote.activeRevision.document = "unexpected";

    expect(() => createDevPublicationRehearsalRecovery(remote))
      .toThrow(DevPublicationRehearsalRecoveryError);
  });
});
