import { describe, expect, it, vi } from "vitest";

import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { createDevPublicationRollbackRecovery } from "./dev-shopify-publication-rehearsal.rollback-recovery.js";
import { executeDevPublicationRollbackStaging } from "./dev-shopify-publication-rehearsal.rollback-staging-execution.js";
import { partialRollbackRemote } from "./dev-shopify-publication-rehearsal.rollback-recovery.test.js";

describe("development publication rollback carrier staging", () => {
  it("writes and verifies one monotonic carrier step per invocation", async () => {
    const value = partialRollbackRemote();
    let remote = structuredClone(value.remote);
    remote.snapshot.document = compileRuntimeSnapshot(value.execution.candidateRevision.configuration);
    remote.activeRevision.document = value.execution.identifiers.candidateRevisionId;
    const persistence = {
      writeRuntimeSnapshot: vi.fn(async ({ snapshot }) => { remote.snapshot.document = structuredClone(snapshot); }),
      compareAndSetActiveRevision: vi.fn(async ({ target_revision_id }) => { remote.activeRevision.document = target_revision_id; }),
    };

    await expect(executeDevPublicationRollbackStaging({
      readRemote: async () => structuredClone(remote),
      persistence,
    })).resolves.toEqual({ status: "ready_to_stage_rollback_pointer", completed_steps: ["snapshot_written"] });
    expect(persistence.compareAndSetActiveRevision).not.toHaveBeenCalled();

    await expect(executeDevPublicationRollbackStaging({
      readRemote: async () => structuredClone(remote),
      persistence,
    })).resolves.toEqual({ status: "ready_to_complete_rollback", completed_steps: ["active_pointer_updated"] });
    expect(createDevPublicationRollbackRecovery(remote).status).toBe("ready_to_complete_rollback");
  });
});
