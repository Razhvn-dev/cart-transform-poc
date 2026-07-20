import {
  PREBUILT_BUNDLE_IMPORT_PLAN_SCHEMA_VERSION,
} from "./prebuilt-bundle-import.plan.js";

export class PrebuiltBundleImportExecutionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "PrebuiltBundleImportExecutionError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Applies only an already reviewed plan through a caller-owned target writer.
 * The module has no Shopify transport, persistence adapter, or Function import.
 */
export async function executeConfirmedPrebuiltBundleImport({
  plan,
  confirmation_token,
  ledger,
  create_target,
  now = () => new Date().toISOString(),
}) {
  assertPlan(plan, confirmation_token);
  assertDependencies({ ledger, create_target });

  const results = [];
  for (const record of plan.records) {
    if (record.status !== "ready_for_confirmation") {
      results.push({
        source_identity: record.source_identity,
        status: "not_executed",
        reason: record.status,
      });
      continue;
    }

    const existing = await ledger.read(record.source_identity);
    if (existing) {
      if (existing.source_fingerprint === record.source_fingerprint
        && existing.target_bundle_definition_id === record.target.bundle_definition_id
        && existing.target_fingerprint === record.target_fingerprint
        && existing.state === "completed") {
        results.push({
          source_identity: record.source_identity,
          status: "already_completed",
          target_bundle_definition_id: record.target.bundle_definition_id,
        });
        continue;
      }
      throw new PrebuiltBundleImportExecutionError(
        "RETRY_CONFLICT",
        `Import source ${record.source_identity} is already associated with different target content.`,
        { existing, record },
      );
    }

    const pending = createLedgerEntry(plan, record, "pending", now());
    await ledger.write(pending);
    try {
      const targetResult = await create_target({
        import_id: plan.import_id,
        source_identity: record.source_identity,
        source_fingerprint: record.source_fingerprint,
        target_fingerprint: record.target_fingerprint,
        target: structuredClone(record.target),
        record: structuredClone(record),
      });
      const completed = {
        ...pending,
        state: "completed",
        completed_at: now(),
        target_result: targetResult == null ? null : structuredClone(targetResult),
      };
      await ledger.write(completed);
      results.push({
        source_identity: record.source_identity,
        status: "completed",
        target_bundle_definition_id: record.target.bundle_definition_id,
      });
    } catch (error) {
      const failed = {
        ...pending,
        state: "failed",
        failed_at: now(),
        error: error instanceof Error ? error.message : String(error),
      };
      await ledger.write(failed);
      results.push({
        source_identity: record.source_identity,
        status: "failed",
        reason: failed.error,
      });
    }
  }

  return Object.freeze({
    import_id: plan.import_id,
    completed: results.filter((result) => result.status === "completed").length,
    already_completed: results.filter((result) => result.status === "already_completed").length,
    failed: results.filter((result) => result.status === "failed").length,
    not_executed: results.filter((result) => result.status === "not_executed").length,
    results: Object.freeze(results),
  });
}

export function createInMemoryPrebuiltBundleImportLedger({ records = [] } = {}) {
  const store = new Map(records.map((record) => [record.source_identity, structuredClone(record)]));
  return {
    async read(sourceIdentity) {
      const value = store.get(sourceIdentity);
      return value == null ? null : structuredClone(value);
    },
    async write(record) {
      if (!record || typeof record.source_identity !== "string") {
        throw new PrebuiltBundleImportExecutionError("INVALID_LEDGER_RECORD", "Ledger record source_identity is required.");
      }
      store.set(record.source_identity, structuredClone(record));
      return structuredClone(record);
    },
    state: store,
  };
}

function assertPlan(plan, confirmationToken) {
  if (plan?.schema_version !== PREBUILT_BUNDLE_IMPORT_PLAN_SCHEMA_VERSION || plan?.mode !== "dry_run") {
    throw new PrebuiltBundleImportExecutionError("INVALID_PLAN", "A current dry-run import plan is required.");
  }
  if (plan.requires_explicit_confirmation !== true || confirmationToken !== plan.confirmation_token) {
    throw new PrebuiltBundleImportExecutionError("CONFIRMATION_REQUIRED", "Import confirmation token does not match the reviewed plan.");
  }
}

function assertDependencies({ ledger, create_target: createTarget }) {
  if (typeof ledger?.read !== "function" || typeof ledger?.write !== "function") {
    throw new PrebuiltBundleImportExecutionError("UNSUPPORTED_CAPABILITY", "A ledger with read and write is required.");
  }
  if (typeof createTarget !== "function") {
    throw new PrebuiltBundleImportExecutionError("UNSUPPORTED_CAPABILITY", "A caller-owned target creator is required.");
  }
}

function createLedgerEntry(plan, record, state, at) {
  return {
    schema_version: "prebuilt_bundle_import_ledger.v1",
    import_id: plan.import_id,
    source_identity: record.source_identity,
    source_fingerprint: record.source_fingerprint,
    target_bundle_definition_id: record.target.bundle_definition_id,
    target_fingerprint: record.target_fingerprint,
    state,
    created_at: at,
    updated_at: at,
  };
}
