import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateProductionPersistenceRolloutReadiness } from "./production-persistence-rollout-readiness.js";

function validEvidence(overrides = {}) {
  return {
    stage: "P3",
    runtime_authority: "hardcoded_shared_core",
    custom_distribution_app_touched: false,
    target: {
      app: "approved-production-app",
      store: "approved-production-store.myshopify.com",
      api_version: "2026-04",
      config: "approved-production-config",
      read_only_identity_verified: true,
    },
    approval: {
      approved_by: "Huang",
      approved_at: "2026-07-17T00:00:00.000Z",
      production_write_approved: true,
    },
    local_validation: {
      npm_test: true,
      function_test: true,
      lint: true,
      build: true,
      validate_local: true,
      production_clean: true,
      diff_check: true,
    },
    resources: {
      bundle_definition_type: "$app:bundle_definition",
      bundle_revision_type: "$app:bundle_revision",
      publication_record_type: "$app:bundle_publication_record",
      runtime_snapshot_key: "bundle_runtime_snapshot_v1",
      active_revision_key: "active_revision_id_v1",
      access_reviewed: true,
      compare_digest_verified: true,
    },
    recovery: {
      previous_function_version: "function-version-id",
      previous_snapshot_checksum: "aabbccdd",
      previous_active_revision_id: "revision-id",
      rollback_owner: "release-owner",
      compensation_runbook_reviewed: true,
    },
    publication_evidence: {
      bundle_definition_id: "definition-id",
      revision_id: "revision-id",
      snapshot_checksum: "aabbccdd",
      fixture_set_id: "full-parity-fixtures",
      exact_parity: true,
      no_unsupported_fields: true,
    },
    ...overrides,
  };
}

describe("production persistence rollout readiness", () => {
  it("accepts a complete P3 evidence package without performing writes", () => {
    const result = evaluateProductionPersistenceRolloutReadiness(validEvidence());

    expect(result).toMatchObject({ ok: true, stage: "P3", writes_performed: false, requires_external_approval: true });
    expect(result.blockers).toEqual([]);
  });

  it("rejects dev target and dev resource names", () => {
    const result = evaluateProductionPersistenceRolloutReadiness(validEvidence({
      target: { ...validEvidence().target, app: "cart-transform-poc-dev" },
      resources: { ...validEvidence().resources, runtime_snapshot_key: "aces_dev.bundle_runtime_snapshot_v1" },
    }));

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "target must not contain a development app, config, namespace, or type token",
      "resources.runtime_snapshot_key must not contain a development token",
    ]));
  });

  it("requires explicit approval and every local validation gate", () => {
    const result = evaluateProductionPersistenceRolloutReadiness(validEvidence({
      approval: { ...validEvidence().approval, production_write_approved: false },
      local_validation: { ...validEvidence().local_validation, production_clean: false },
    }));

    expect(result.blockers).toEqual(expect.arrayContaining([
      "approval.production_write_approved must be true",
      "local_validation.production_clean must be true",
    ]));
  });

  it("requires P4 browser, order, and rollback regression evidence", () => {
    const result = evaluateProductionPersistenceRolloutReadiness(validEvidence({ stage: "P4" }));

    expect(result.blockers).toEqual(expect.arrayContaining([
      "authority_regression must be an object",
    ]));
  });

  it("rejects any authority change or Custom Distribution App activity", () => {
    const result = evaluateProductionPersistenceRolloutReadiness(validEvidence({
      runtime_authority: "runtime_snapshot",
      custom_distribution_app_touched: true,
    }));

    expect(result.blockers).toEqual(expect.arrayContaining([
      "runtime_authority must remain hardcoded_shared_core until a separately approved authority decision",
      "Custom Distribution App must not be touched by this readiness workflow",
    ]));
  });

  it("runs locally from an evidence file and returns a failing exit code for incomplete evidence", () => {
    const directory = mkdtempSync(join(tmpdir(), "production-readiness-"));
    const passingInput = join(directory, "passing.json");
    const failingInput = join(directory, "failing.json");
    writeFileSync(passingInput, JSON.stringify(validEvidence()));
    writeFileSync(failingInput, JSON.stringify(validEvidence({ approval: { ...validEvidence().approval, production_write_approved: false } })));

    const passing = spawnSync(process.execPath, ["scripts/check-production-persistence-rollout-readiness.mjs", "--input", passingInput], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const failing = spawnSync(process.execPath, ["scripts/check-production-persistence-rollout-readiness.mjs", "--input", failingInput], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(passing.status).toBe(0);
    expect(JSON.parse(passing.stdout)).toMatchObject({ ok: true, writes_performed: false });
    expect(failing.status).toBe(1);
    expect(JSON.parse(failing.stdout).blockers).toContain("approval.production_write_approved must be true");
  });
});
