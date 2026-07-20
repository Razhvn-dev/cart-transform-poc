import { PREBUILT_BUNDLE_IMPORT_PLAN_SCHEMA_VERSION } from "./prebuilt-bundle-import.plan.js";

/**
 * Read-only recovery assessment for a confirmed import plan. It never calls a
 * target writer: pending or failed rows require target reconciliation first.
 */
export function assessPrebuiltBundleImportRecovery({ plan, ledger_records } = {}) {
  assertPlan(plan);
  const recordsBySourceIdentity = new Map(
    Array.isArray(ledger_records)
      ? ledger_records.filter(isLedgerRecord).map((record) => [record.source_identity, record])
      : [],
  );

  const records = plan.records.map((record) => assessRecord(record, recordsBySourceIdentity.get(record.source_identity)));
  return deepFreeze({
    import_id: plan.import_id,
    status: records.some((record) => record.status === "retry_conflict") ? "blocked" : "ready_for_reconciliation",
    summary: summarize(records),
    records,
  });
}

function assessRecord(planRecord, ledgerRecord) {
  const base = {
    source_identity: planRecord.source_identity,
    target_bundle_definition_id: planRecord.target?.bundle_definition_id ?? null,
  };
  if (planRecord.status !== "ready_for_confirmation") {
    return { ...base, status: "not_eligible", reason: planRecord.status };
  }
  if (!ledgerRecord) return { ...base, status: "ready_to_execute", reason: null };

  const matchesPlan = ledgerRecord.source_fingerprint === planRecord.source_fingerprint
    && ledgerRecord.target_bundle_definition_id === planRecord.target.bundle_definition_id
    && ledgerRecord.target_fingerprint === planRecord.target_fingerprint;
  if (!matchesPlan) return { ...base, status: "retry_conflict", reason: "LEDGER_CONTENT_MISMATCH" };
  if (ledgerRecord.state === "completed") return { ...base, status: "already_completed", reason: null };
  if (ledgerRecord.state === "pending" || ledgerRecord.state === "failed") {
    return {
      ...base,
      status: "requires_target_reconciliation",
      reason: ledgerRecord.state === "pending" ? "PENDING_TARGET_OUTCOME_UNKNOWN" : "FAILED_TARGET_OUTCOME_UNKNOWN",
    };
  }
  return { ...base, status: "retry_conflict", reason: "LEDGER_STATE_UNSUPPORTED" };
}

function summarize(records) {
  return records.reduce((summary, record) => {
    summary[record.status] += 1;
    return summary;
  }, {
    ready_to_execute: 0,
    already_completed: 0,
    requires_target_reconciliation: 0,
    retry_conflict: 0,
    not_eligible: 0,
  });
}

function assertPlan(plan) {
  if (plan?.schema_version !== PREBUILT_BUNDLE_IMPORT_PLAN_SCHEMA_VERSION || plan?.mode !== "dry_run") {
    throw new TypeError("A current dry-run pre-built import plan is required.");
  }
}

function isLedgerRecord(record) {
  return record != null && typeof record === "object" && typeof record.source_identity === "string";
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
