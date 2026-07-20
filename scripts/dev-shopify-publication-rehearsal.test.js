import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { masterKitConfigV1 } from "../extensions/master-kit-expand/src/config/fixtures/master-kit-config.v1.js";
import {
  DEV_PUBLICATION_REHEARSAL_BINDINGS,
  DevPublicationRehearsalPlanError,
  assertDevPublicationRehearsalPlan,
  createDevPublicationRehearsalPlan,
} from "./dev-shopify-publication-rehearsal.js";

const ids = {
  runId: "a1111111-1111-4111-8111-111111111111",
  baselineRevisionId: "a2222222-2222-4222-8222-222222222222",
  candidateRevisionId: "a3333333-3333-4333-8333-333333333333",
  baselinePublicationId: "a4444444-4444-4444-8444-444444444444",
  candidatePublicationId: "a5555555-5555-4555-8555-555555555555",
};

describe("development publication rehearsal planning", () => {
  it("creates a local-only plan with isolated carriers and exact parity evidence", () => {
    const baseline = configuration(1, "draft");
    const candidate = configuration(2, "draft");
    const plan = createDevPublicationRehearsalPlan({ ...ids, baselineConfiguration: baseline, candidateConfiguration: candidate });

    expect(plan.mode).toBe("local_only");
    expect(plan.isolation.bindings).toEqual(DEV_PUBLICATION_REHEARSAL_BINDINGS);
    expect(plan.isolation.forbidden_runtime_snapshot_keys).toEqual([
      "bundle_runtime_snapshot_v1",
      "bundle_runtime_snapshot_test",
    ]);
    expect(plan.candidate.promotion_evidence.snapshot_checksum).toBe(plan.candidate.snapshot_checksum);
    expect(plan.candidate.snapshot_byte_size).toBeGreaterThan(0);
    expect(plan.operations).not.toContain("apply");
    expect(() => assertDevPublicationRehearsalPlan(plan)).not.toThrow();
  });

  it("rejects any attempt to reuse a primary or legacy dev carrier", () => {
    expect(() => createDevPublicationRehearsalPlan({
      ...ids,
      baselineConfiguration: configuration(1),
      candidateConfiguration: configuration(2),
      bindings: { ...DEV_PUBLICATION_REHEARSAL_BINDINGS, runtimeSnapshotKey: "bundle_runtime_snapshot_v1" },
    })).toThrow(DevPublicationRehearsalPlanError);
  });

  it("rejects non-monotonic candidate versions and duplicate identities", () => {
    expect(() => createDevPublicationRehearsalPlan({
      ...ids,
      baselineConfiguration: configuration(2),
      candidateConfiguration: configuration(1),
    })).toThrow(/configuration_version/);

    expect(() => createDevPublicationRehearsalPlan({
      ...ids,
      candidateRevisionId: ids.runId,
      baselineConfiguration: configuration(1),
      candidateConfiguration: configuration(2),
    })).toThrow(/distinct/);
  });

  it("has no apply mode, even when an operator requests one", () => {
    const result = spawnSync(process.execPath, [
      "scripts/plan-dev-shopify-publication-rehearsal.mjs",
      "--apply",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("has no apply mode");
  });
});

function configuration(version, status = "draft") {
  const config = structuredClone(masterKitConfigV1);
  config.configuration_version = version;
  config.status = status;
  config.revision = { ...config.revision, draft_revision: version, published_revision: Math.max(1, version - 1) };
  return config;
}
