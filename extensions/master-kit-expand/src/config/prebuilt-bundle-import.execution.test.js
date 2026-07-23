import { describe, expect, it, vi } from "vitest";
import { createPrebuiltBundleImportPlan } from "./prebuilt-bundle-import.plan.js";
import {
  PrebuiltBundleImportExecutionError,
  createInMemoryPrebuiltBundleImportLedger,
  executeConfirmedPrebuiltBundleImport,
} from "./prebuilt-bundle-import.execution.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";

const importId = "91f1b0e1-0f9f-4ea4-8bb4-1f2dc1aef711";
const definitionId = "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89";

function plan() {
  const configuration = structuredClone(masterKitConfigV1);
  configuration.configuration_id = definitionId;
  return createPrebuiltBundleImportPlan({
    import_id: importId,
    source_records: [{
      schema_version: "prebuilt_bundle_import_source.v1",
      source_system: "legacy-paid-app",
      source_bundle_id: "legacy-standard-build",
      source_checksum: "legacy-checksum-1",
      product_series_key: "aces-efi",
      parent_binding: { product_gid: masterKitConfigV1.parent.product_gid, variant_gid: masterKitConfigV1.parent.variant_gid },
      components: [
        { variant_gid: "gid://shopify/ProductVariant/51592538587414", quantity: 1 },
        { variant_gid: "gid://shopify/ProductVariant/51505348346134", quantity: 1 },
        { variant_gid: "gid://shopify/ProductVariant/51592730706198", quantity: 1 },
      ],
    }],
    mappings: [{
      schema_version: "prebuilt_bundle_import_mapping.v1",
      source_identity: "legacy-paid-app:legacy-standard-build",
      target: {
        bundle_definition_id: definitionId,
        parent_binding: { product_gid: masterKitConfigV1.parent.product_gid, variant_gid: masterKitConfigV1.parent.variant_gid },
      },
      configuration,
      fixed_selections: {
        efi_system: "efi_killshot_fusion_lite",
        fuel_system: "fuel_test",
        ignition: "ignition_black_jack_coil",
      },
    }],
    pilot_scope: {
      schema_version: "prebuilt_bundle_pilot_scope.v1",
      pilot_scope_id: "81f1b0e1-0f9f-4ea4-8bb4-1f2dc1aef710",
      store_domain: "huang-mvqquz1p.myshopify.com",
      approved_product_series_keys: ["aces-efi"],
      approved_parent_variant_gids: [masterKitConfigV1.parent.variant_gid],
    },
  });
}

describe("confirmed pre-built bundle import execution", () => {
  it("uses a caller-owned target creator only after plan confirmation", async () => {
    const reviewed = plan();
    const createTarget = vi.fn().mockResolvedValue({ created: true });
    const ledger = createInMemoryPrebuiltBundleImportLedger();

    const result = await executeConfirmedPrebuiltBundleImport({
      plan: reviewed,
      confirmation_token: reviewed.confirmation_token,
      ledger,
      create_target: createTarget,
      now: () => "2026-07-17T01:00:00Z",
    });

    expect(result.completed).toBe(1);
    expect(createTarget).toHaveBeenCalledTimes(1);
    expect(createTarget.mock.calls[0][0].target.configuration.configuration_id).toBe(definitionId);
    expect(ledger.state.get("legacy-paid-app:legacy-standard-build").state).toBe("completed");
  });

  it("does not execute without the exact reviewed-plan confirmation token", async () => {
    const reviewed = plan();
    const createTarget = vi.fn();
    await expect(executeConfirmedPrebuiltBundleImport({
      plan: reviewed,
      confirmation_token: "incorrect",
      ledger: createInMemoryPrebuiltBundleImportLedger(),
      create_target: createTarget,
    })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(createTarget).not.toHaveBeenCalled();
  });

  it("is idempotent for a completed source fingerprint and target", async () => {
    const reviewed = plan();
    const ledger = createInMemoryPrebuiltBundleImportLedger();
    const createTarget = vi.fn().mockResolvedValue({ created: true });
    await executeConfirmedPrebuiltBundleImport({ plan: reviewed, confirmation_token: reviewed.confirmation_token, ledger, create_target: createTarget });
    const retry = await executeConfirmedPrebuiltBundleImport({ plan: reviewed, confirmation_token: reviewed.confirmation_token, ledger, create_target: createTarget });
    expect(retry.already_completed).toBe(1);
    expect(createTarget).toHaveBeenCalledTimes(1);
  });

  it("records a target failure for recovery instead of claiming completion", async () => {
    const reviewed = plan();
    const result = await executeConfirmedPrebuiltBundleImport({
      plan: reviewed,
      confirmation_token: reviewed.confirmation_token,
      ledger: createInMemoryPrebuiltBundleImportLedger(),
      create_target: async () => { throw new Error("target unavailable"); },
    });
    expect(result.failed).toBe(1);
    expect(result.results[0].reason).toBe("target unavailable");
  });

  it("rejects a source retry that would overwrite different target content", async () => {
    const reviewed = plan();
    const record = reviewed.records[0];
    const ledger = createInMemoryPrebuiltBundleImportLedger({ records: [{
      source_identity: record.source_identity,
      source_fingerprint: "different",
      target_bundle_definition_id: record.target.bundle_definition_id,
      target_fingerprint: record.target_fingerprint,
      state: "completed",
    }] });
    await expect(executeConfirmedPrebuiltBundleImport({
      plan: reviewed,
      confirmation_token: reviewed.confirmation_token,
      ledger,
      create_target: vi.fn(),
    })).rejects.toBeInstanceOf(PrebuiltBundleImportExecutionError);
  });
});
