const VALID_STAGES = new Set(["P0", "P1", "P2", "P3", "P4"]);
const DEV_TOKENS = ["aces_dev", "_dev", "cart-transform-poc-dev", "shopify.app.dev.toml", "shopify.app.local.toml"];

export function evaluateProductionPersistenceRolloutReadiness(input) {
  const blockers = [];
  const warnings = [];
  const completed = [];

  if (!isPlainObject(input)) {
    return result({ blockers: ["input must be an object"], warnings, completed });
  }

  const stage = requiredString(input.stage, "stage", blockers);
  if (stage && !VALID_STAGES.has(stage)) blockers.push("stage must be one of P0, P1, P2, P3, P4");

  const target = object(input.target, "target", blockers);
  if (target) {
    requireProductionIdentity(target, blockers, completed);
  }

  requireApproval(input.approval, blockers, completed);
  requireLocalValidation(input.local_validation, blockers, completed);
  requireProductionResources(input.resources, blockers, completed);

  if (stage && ["P2", "P3", "P4"].includes(stage)) {
    requireRecoveryEvidence(input.recovery, blockers, completed);
  }
  if (stage && ["P3", "P4"].includes(stage)) {
    requirePublicationEvidence(input.publication_evidence, blockers, completed);
  }
  if (stage === "P4") {
    requireAuthorityRegression(input.authority_regression, blockers, completed);
  }

  if (input.runtime_authority !== "hardcoded_shared_core") {
    blockers.push("runtime_authority must remain hardcoded_shared_core until a separately approved authority decision");
  } else {
    completed.push("hardcoded runtime authority retained");
  }

  if (input.custom_distribution_app_touched === true) {
    blockers.push("Custom Distribution App must not be touched by this readiness workflow");
  } else {
    completed.push("Custom Distribution App remains out of scope");
  }

  if (input.notes && typeof input.notes !== "string") warnings.push("notes should be a string when supplied");
  return result({ blockers, warnings, completed, stage: stage ?? null });
}

function requireProductionIdentity(target, blockers, completed) {
  for (const key of ["app", "store", "api_version", "config"]) {
    requiredString(target[key], `target.${key}`, blockers);
  }
  const flattened = JSON.stringify(target).toLowerCase();
  if (DEV_TOKENS.some((token) => flattened.includes(token))) {
    blockers.push("target must not contain a development app, config, namespace, or type token");
  } else if (target.app && target.store && target.api_version && target.config) {
    completed.push("production target identity supplied without development tokens");
  }
  if (target.read_only_identity_verified !== true) {
    blockers.push("target.read_only_identity_verified must be true");
  } else {
    completed.push("production identity was verified read-only");
  }
}

function requireApproval(approval, blockers, completed) {
  const value = object(approval, "approval", blockers);
  if (!value) return;
  requiredString(value.approved_by, "approval.approved_by", blockers);
  requiredString(value.approved_at, "approval.approved_at", blockers);
  if (value.production_write_approved !== true) {
    blockers.push("approval.production_write_approved must be true");
  } else {
    completed.push("explicit production write approval recorded");
  }
}

function requireLocalValidation(validation, blockers, completed) {
  const value = object(validation, "local_validation", blockers);
  if (!value) return;
  for (const key of ["npm_test", "function_test", "lint", "build", "validate_local", "production_clean", "diff_check"]) {
    if (value[key] !== true) blockers.push(`local_validation.${key} must be true`);
  }
  if (["npm_test", "function_test", "lint", "build", "validate_local", "production_clean", "diff_check"].every((key) => value[key] === true)) {
    completed.push("full local validation recorded");
  }
}

function requireProductionResources(resources, blockers, completed) {
  const value = object(resources, "resources", blockers);
  if (!value) return;
  for (const key of ["bundle_definition_type", "bundle_revision_type", "publication_record_type", "runtime_snapshot_key", "active_revision_key"]) {
    const candidate = requiredString(value[key], `resources.${key}`, blockers);
    if (candidate && DEV_TOKENS.some((token) => candidate.toLowerCase().includes(token))) {
      blockers.push(`resources.${key} must not contain a development token`);
    }
  }
  if (value.access_reviewed !== true) blockers.push("resources.access_reviewed must be true");
  if (value.compare_digest_verified !== true) blockers.push("resources.compare_digest_verified must be true");
  if (value.access_reviewed === true && value.compare_digest_verified === true) {
    completed.push("production resource access and compareDigest behavior reviewed");
  }
}

function requireRecoveryEvidence(recovery, blockers, completed) {
  const value = object(recovery, "recovery", blockers);
  if (!value) return;
  for (const key of ["previous_function_version", "previous_snapshot_checksum", "previous_active_revision_id", "rollback_owner"]) {
    requiredString(value[key], `recovery.${key}`, blockers);
  }
  if (value.compensation_runbook_reviewed !== true) blockers.push("recovery.compensation_runbook_reviewed must be true");
  if (value.compensation_runbook_reviewed === true) completed.push("recovery evidence and compensation owner recorded");
}

function requirePublicationEvidence(evidence, blockers, completed) {
  const value = object(evidence, "publication_evidence", blockers);
  if (!value) return;
  for (const key of ["bundle_definition_id", "revision_id", "snapshot_checksum", "fixture_set_id"]) {
    requiredString(value[key], `publication_evidence.${key}`, blockers);
  }
  if (value.exact_parity !== true) blockers.push("publication_evidence.exact_parity must be true");
  if (value.no_unsupported_fields !== true) blockers.push("publication_evidence.no_unsupported_fields must be true");
  if (value.exact_parity === true && value.no_unsupported_fields === true) {
    completed.push("publication parity evidence recorded");
  }
}

function requireAuthorityRegression(regression, blockers, completed) {
  const value = object(regression, "authority_regression", blockers);
  if (!value) return;
  for (const key of ["browser_cart_checkout", "order_inventory", "hardcoded_rollback_verified"]) {
    if (value[key] !== true) blockers.push(`authority_regression.${key} must be true`);
  }
  if (["browser_cart_checkout", "order_inventory", "hardcoded_rollback_verified"].every((key) => value[key] === true)) {
    completed.push("authority regression evidence recorded");
  }
}

function object(value, name, blockers) {
  if (!isPlainObject(value)) {
    blockers.push(`${name} must be an object`);
    return null;
  }
  return value;
}

function requiredString(value, name, blockers) {
  if (typeof value !== "string" || value.trim() === "") {
    blockers.push(`${name} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function result({ blockers, warnings, completed, stage = null }) {
  return {
    ok: blockers.length === 0,
    stage,
    blockers,
    warnings,
    completed_steps: [...new Set(completed)],
    requires_external_approval: true,
    writes_performed: false,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
