import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { assessLocalReleaseCandidate } from "./local-release-candidate-readiness.js";

describe("local release candidate readiness", () => {
  it("accepts a structurally complete local candidate without authorizing deployment", () => {
    const result = assessLocalReleaseCandidate(validInput());

    expect(result).toMatchObject({
      status: "ready_for_release_review",
      ready_for_release_review: true,
      ready_to_deploy: false,
      requires_external_approval: true,
      writes_performed: false,
    });
  });

  it("blocks secrets, local config, Custom Distribution config, and native Bundle seed writes", () => {
    const input = validInput();
    const result = assessLocalReleaseCandidate({
      ...input,
      changes: [
        ...input.changes,
        { status: "??", path: ".env.production" },
        { status: "M", path: "shopify.app.local.toml" },
        { status: "M", path: "shopify.app.toml" },
      ],
      seed_source: "productVariantRelationshipBulkUpdate requiresComponents: true",
    });

    expect(result.ready_for_release_review).toBe(false);
    expect(result.blockers.map((item) => item.code)).toEqual(expect.arrayContaining([
      "FORBIDDEN_RELEASE_FILE",
      "CUSTOM_DISTRIBUTION_CONFIG_CHANGED",
      "NATIVE_BUNDLE_SEED_WRITE_PRESENT",
    ]));
  });

  it("audits the real working tree without mutating it and rejects write flags", () => {
    const checked = spawnSync(process.execPath, ["scripts/check-local-release-candidate.mjs"], cliOptions());
    const rejected = spawnSync(process.execPath, ["scripts/check-local-release-candidate.mjs", "--deploy"], cliOptions());

    expect(checked.status).toBe(0);
    expect(JSON.parse(checked.stdout)).toMatchObject({ ready_for_release_review: true, writes_performed: false });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("cannot stage, commit, push, or deploy");
  });
});

function validInput() {
  return {
    changes: [{ status: "M", path: "scripts/example.js" }],
    existing_paths: [
      "Project_Master_Context_V5.4_Current_Baseline.md",
      "app/routes/app.bundle-admin.prebuilt-imports.tsx",
      "docs/JOSH_SYNTHETIC_DEMO_FLOW_2026-07-20.md",
      "docs/JOSH_DEMO_SCRIPT_EN_2026-07-20.md",
      "docs/JOSH_DEMO_OPERATOR_CHECKLIST_ZH_2026-07-20.md",
      "docs/LOCAL_COMPLETION_AND_EXTERNAL_DEPENDENCIES_2026-07-20.md",
      "docs/LOCAL_RELEASE_CANDIDATE_MANIFEST_2026-07-20.md",
      "docs/PREBUILT_PILOT_OUTSTANDING_WORK_2026-07-20.md",
      "scripts/check-native-bundle-migration-acceptance.mjs",
      "scripts/check-prebuilt-bundle-pilot-acceptance.mjs",
      "scripts/plan-native-bundle-migration.mjs",
      "scripts/plan-prebuilt-bundle-source-import.mjs",
    ],
    seed_source: "Cart Transform expand only",
    package_document: {
      scripts: {
        "validate:local": "validate",
        "assert:function:production-clean": "assert",
        "plan:native-bundle-migration": "plan",
        "check:native-bundle-migration": "check",
        "check:prebuilt-bundle-pilot": "pilot",
      },
    },
  };
}

function cliOptions() {
  return { cwd: process.cwd(), encoding: "utf8" };
}
