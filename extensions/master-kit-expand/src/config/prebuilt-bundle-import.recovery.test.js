import { describe, expect, it } from "vitest";

import { createPrebuiltBundleImportPlan } from "./prebuilt-bundle-import.plan.js";
import { assessPrebuiltBundleImportRecovery } from "./prebuilt-bundle-import.recovery.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";

const definitionId = "61c40f6d-52b0-4a72-8000-000000000001";

function plan() {
  const configuration = structuredClone(masterKitConfigV1);
  configuration.configuration_id = definitionId;
  return createPrebuiltBundleImportPlan({
    import_id: "61c40f6d-52b0-4a72-8000-000000000002",
    source_records: [{
      schema_version: "prebuilt_bundle_import_source.v1",
      source_system: "legacy-paid-app",
      source_bundle_id: "standard-build",
      source_checksum: "source-checksum",
      product_series_key: "aces-efi",
      parent_binding: structuredClone(masterKitConfigV1.parent),
      components: [
        { variant_gid: "gid://shopify/ProductVariant/51592538587414", quantity: 1 },
        { variant_gid: "gid://shopify/ProductVariant/51505348346134", quantity: 1 },
        { variant_gid: "gid://shopify/ProductVariant/51592730706198", quantity: 1 },
      ],
    }],
    mappings: [{
      schema_version: "prebuilt_bundle_import_mapping.v1",
      source_identity: "legacy-paid-app:standard-build",
      target: { bundle_definition_id: definitionId, parent_binding: structuredClone(masterKitConfigV1.parent) },
      configuration,
      fixed_selections: {
        efi_system: "efi_killshot_fusion_lite",
        fuel_system: "fuel_test",
        ignition: "ignition_black_jack_coil",
      },
    }],
    pilot_scope: {
      schema_version: "prebuilt_bundle_pilot_scope.v1",
      pilot_scope_id: "61c40f6d-52b0-4a72-8000-000000000003",
      store_domain: "huang-mvqquz1p.myshopify.com",
      approved_product_series_keys: ["aces-efi"],
      approved_parent_variant_gids: [masterKitConfigV1.parent.variant_gid],
    },
  });
}

function ledgerRecord(reviewed, state, overrides = {}) {
  const record = reviewed.records[0];
  return {
    schema_version: "prebuilt_bundle_import_ledger.v1",
    import_id: reviewed.import_id,
    source_identity: record.source_identity,
    source_fingerprint: record.source_fingerprint,
    target_bundle_definition_id: record.target.bundle_definition_id,
    target_fingerprint: record.target_fingerprint,
    state,
    ...overrides,
  };
}

describe("pre-built import recovery assessment", () => {
  it("identifies a reviewed record that has not started", () => {
    const result = assessPrebuiltBundleImportRecovery({ plan: plan(), ledger_records: [] });
    expect(result).toMatchObject({
      status: "ready_for_reconciliation",
      summary: { ready_to_execute: 1 },
      records: [{ status: "ready_to_execute", reason: null }],
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("marks only matching completed records as idempotently complete", () => {
    const reviewed = plan();
    const result = assessPrebuiltBundleImportRecovery({
      plan: reviewed,
      ledger_records: [ledgerRecord(reviewed, "completed")],
    });
    expect(result.summary.already_completed).toBe(1);
    expect(result.records[0]).toMatchObject({ status: "already_completed", reason: null });
  });

  it("blocks a completed ledger row from a different import even when its content matches", () => {
    const reviewed = plan();
    const result = assessPrebuiltBundleImportRecovery({
      plan: reviewed,
      ledger_records: [ledgerRecord(reviewed, "completed", {
        import_id: "61c40f6d-52b0-4a72-8000-000000000099",
      })],
    });

    expect(result).toMatchObject({
      status: "blocked",
      summary: { already_completed: 0, retry_conflict: 1 },
      records: [{ status: "retry_conflict", reason: "LEDGER_CONTENT_MISMATCH" }],
    });
  });

  it("requires target reconciliation after pending or failed target outcomes", () => {
    const reviewed = plan();
    for (const state of ["pending", "failed"]) {
      const result = assessPrebuiltBundleImportRecovery({
        plan: reviewed,
        ledger_records: [ledgerRecord(reviewed, state)],
      });
      expect(result.records[0]).toMatchObject({
        status: "requires_target_reconciliation",
        reason: state === "pending" ? "PENDING_TARGET_OUTCOME_UNKNOWN" : "FAILED_TARGET_OUTCOME_UNKNOWN",
      });
    }
  });

  it("blocks changed source content, target identity, or unknown ledger states", () => {
    const reviewed = plan();
    const mismatched = assessPrebuiltBundleImportRecovery({
      plan: reviewed,
      ledger_records: [ledgerRecord(reviewed, "completed", { source_fingerprint: "changed" })],
    });
    const unsupported = assessPrebuiltBundleImportRecovery({
      plan: reviewed,
      ledger_records: [ledgerRecord(reviewed, "unknown")],
    });

    expect(mismatched).toMatchObject({ status: "blocked", records: [{ reason: "LEDGER_CONTENT_MISMATCH" }] });
    expect(unsupported).toMatchObject({ status: "blocked", records: [{ reason: "LEDGER_STATE_UNSUPPORTED" }] });
  });

  it("rejects any non-current dry-run plan", () => {
    expect(() => assessPrebuiltBundleImportRecovery({ plan: { mode: "apply" } })).toThrow("dry-run");
  });
});
