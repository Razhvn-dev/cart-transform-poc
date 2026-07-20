const REQUIRED_PATHS = [
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
];

const FORBIDDEN_RELEASE_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/i,
  /\.docx$/i,
  /\.(?:pem|key|p12|pfx)$/i,
  /(^|\/)shopify\.app\.local\.toml$/i,
];

export function assessLocalReleaseCandidate({
  changes = [],
  existing_paths = [],
  seed_source = "",
  package_document = null,
} = {}) {
  const blockers = [];
  const warnings = [];
  const existing = new Set(existing_paths.map(normalizePath));
  const normalizedChanges = changes.map((change) => ({
    status: String(change?.status ?? "").trim(),
    path: normalizePath(change?.path ?? ""),
  }));

  for (const path of REQUIRED_PATHS) {
    if (!existing.has(path)) blockers.push(issue("REQUIRED_RELEASE_FILE_MISSING", path));
  }
  for (const change of normalizedChanges) {
    if (FORBIDDEN_RELEASE_PATTERNS.some((pattern) => pattern.test(change.path))) {
      blockers.push(issue("FORBIDDEN_RELEASE_FILE", change.path));
    }
    if (change.path === "shopify.app.toml") {
      blockers.push(issue("CUSTOM_DISTRIBUTION_CONFIG_CHANGED", change.path));
    }
    if (change.status.includes("D")) warnings.push(issue("DELETED_FILE_REQUIRES_REVIEW", change.path));
  }

  for (const token of [
    "productVariantRelationshipBulkUpdate",
    "requiresComponents: true",
    "removeAllProductVariantRelationships",
  ]) {
    if (seed_source.includes(token)) blockers.push(issue("NATIVE_BUNDLE_SEED_WRITE_PRESENT", token));
  }

  const scripts = package_document?.scripts;
  for (const script of [
    "validate:local",
    "assert:function:production-clean",
    "plan:native-bundle-migration",
    "check:native-bundle-migration",
    "check:prebuilt-bundle-pilot",
  ]) {
    if (typeof scripts?.[script] !== "string" || scripts[script].trim() === "") {
      blockers.push(issue("REQUIRED_PACKAGE_SCRIPT_MISSING", script));
    }
  }

  if (normalizedChanges.length === 0) warnings.push(issue("NO_LOCAL_CHANGES", "working_tree"));
  if (normalizedChanges.length > 100) {
    warnings.push(issue("LARGE_RELEASE_SCOPE_REQUIRES_MANUAL_REVIEW", String(normalizedChanges.length)));
  }

  return Object.freeze({
    schema_version: "local_release_candidate_readiness.v1",
    status: blockers.length === 0 ? "ready_for_release_review" : "blocked",
    ready_for_release_review: blockers.length === 0,
    ready_to_deploy: false,
    requires_external_approval: true,
    writes_performed: false,
    summary: {
      changed_files: normalizedChanges.length,
      blockers: blockers.length,
      warnings: warnings.length,
      by_area: countByArea(normalizedChanges),
    },
    blockers,
    warnings,
    required_manual_gates: [
      "review_and_isolate_the_dirty_worktree_scope",
      "confirm_no_user_owned_change_is_omitted_or_overwritten",
      "record_full_local_validation",
      "obtain_commit_push_and_development_release_approval",
      "verify_healthz_and_embedded_admin_after_release",
    ],
  });
}

function countByArea(changes) {
  const counts = { app: 0, extensions: 0, scripts: 0, docs: 0, tests: 0, root: 0 };
  for (const { path } of changes) {
    const area = Object.keys(counts).find((candidate) => path.startsWith(`${candidate}/`)) ?? "root";
    counts[area] += 1;
  }
  return counts;
}

function issue(code, subject) {
  return Object.freeze({ code, subject });
}

function normalizePath(path) {
  return String(path).replaceAll("\\", "/").replace(/^\.\//, "");
}
