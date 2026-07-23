import { describe, expect, it } from "vitest";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import {
  PREBUILT_BUNDLE_IMPORT_MAPPING_SCHEMA_VERSION,
  PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION,
  PREBUILT_BUNDLE_PILOT_SCOPE_SCHEMA_VERSION,
  createPrebuiltBundleImportPlan,
  validatePilotScope,
} from "./prebuilt-bundle-import.plan.js";

const importId = "91f1b0e1-0f9f-4ea4-8bb4-1f2dc1aef711";
const definitionId = "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89";

function source(overrides = {}) {
  return {
    schema_version: PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION,
    source_system: "legacy-paid-app",
    source_bundle_id: "legacy-standard-build",
    source_checksum: "legacy-checksum-1",
    product_series_key: "aces-efi",
    parent_binding: {
      product_gid: masterKitConfigV1.parent.product_gid,
      variant_gid: masterKitConfigV1.parent.variant_gid,
    },
    components: [
      { variant_gid: "gid://shopify/ProductVariant/51592538587414", quantity: 1 },
      { variant_gid: "gid://shopify/ProductVariant/51505348346134", quantity: 1 },
      { variant_gid: "gid://shopify/ProductVariant/51592730706198", quantity: 1 },
    ],
    ...overrides,
  };
}

function pilotScope(overrides = {}) {
  return {
    schema_version: PREBUILT_BUNDLE_PILOT_SCOPE_SCHEMA_VERSION,
    pilot_scope_id: "81f1b0e1-0f9f-4ea4-8bb4-1f2dc1aef710",
    store_domain: "huang-mvqquz1p.myshopify.com",
    approved_product_series_keys: ["aces-efi"],
    approved_parent_variant_gids: [masterKitConfigV1.parent.variant_gid],
    ...overrides,
  };
}

function mapping(overrides = {}) {
  const configuration = structuredClone(masterKitConfigV1);
  configuration.configuration_id = definitionId;
  return {
    schema_version: PREBUILT_BUNDLE_IMPORT_MAPPING_SCHEMA_VERSION,
    source_identity: "legacy-paid-app:legacy-standard-build",
    target: {
      bundle_definition_id: definitionId,
      parent_binding: {
        product_gid: masterKitConfigV1.parent.product_gid,
        variant_gid: masterKitConfigV1.parent.variant_gid,
      },
    },
    configuration,
    fixed_selections: {
      efi_system: "efi_killshot_fusion_lite",
      fuel_system: "fuel_test",
      ignition: "ignition_black_jack_coil",
      display: "display_5_hd_handheld",
    },
    ...overrides,
  };
}

describe("pre-built bundle import dry-run plan", () => {
  it("creates an immutable, confirmation-gated plan for a pilot-compatible source bundle", () => {
    const plan = createPrebuiltBundleImportPlan({
      import_id: importId,
      source_records: [source()],
      mappings: [mapping()],
      pilot_scope: pilotScope(),
    });

    expect(plan.mode).toBe("dry_run");
    expect(plan.requires_explicit_confirmation).toBe(true);
    expect(plan.summary.ready_for_confirmation).toBe(1);
    expect(plan.records[0].existing_target).toBe(false);
    expect(plan.records[0].issues).toEqual([]);
    expect(plan.records[0].target.fixed_selections.efi_system).toBe("efi_killshot_fusion_lite");
    expect(plan.records[0].target.configuration.configuration_id).toBe(definitionId);
    expect(plan.records[0].target_fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it("binds confirmation to the complete reviewed target configuration", () => {
    const first = createPrebuiltBundleImportPlan({
      import_id: importId,
      source_records: [source()],
      mappings: [mapping()],
      pilot_scope: pilotScope(),
    });
    const changedConfiguration = structuredClone(mapping().configuration);
    changedConfiguration.parent.title = "Changed reviewed title";
    const second = createPrebuiltBundleImportPlan({
      import_id: importId,
      source_records: [source()],
      mappings: [mapping({ configuration: changedConfiguration })],
      pilot_scope: pilotScope(),
    });

    expect(second.records[0].status).toBe("ready_for_confirmation");
    expect(second.records[0].target_fingerprint).not.toBe(first.records[0].target_fingerprint);
    expect(second.confirmation_token).not.toBe(first.confirmation_token);
  });

  it("requires an explicit mapping and never treats an unmapped record as ready", () => {
    const plan = createPrebuiltBundleImportPlan({
      import_id: importId,
      source_records: [source()],
      mappings: [],
      pilot_scope: pilotScope(),
    });
    expect(plan.records[0].status).toBe("rejected");
    expect(plan.records[0].issues.map((item) => item.code)).toContain("MAPPING_REQUIRED");
  });

  it("rejects fixed selections that do not reproduce the source component sequence", () => {
    const plan = createPrebuiltBundleImportPlan({
      import_id: importId,
      source_records: [source()],
      mappings: [mapping({ fixed_selections: { efi_system: "efi_killshot_2_pro" } })],
      pilot_scope: pilotScope(),
    });
    expect(plan.records[0].issues.map((item) => item.code)).toContain("COMPONENT_PARITY_MISMATCH");
  });

  it("rejects parent bindings already owned by a target BundleDefinition", () => {
    const plan = createPrebuiltBundleImportPlan({
      import_id: importId,
      source_records: [source()],
      mappings: [mapping()],
      pilot_scope: pilotScope(),
      existing_parent_variant_gids: [masterKitConfigV1.parent.variant_gid],
    });
    expect(plan.records[0].issues.map((item) => item.code)).toContain("EXISTING_PARENT_BINDING");
  });

  it("keeps an exact existing target binding eligible for an idempotent execution retry", () => {
    const targetMapping = mapping();
    const plan = createPrebuiltBundleImportPlan({
      import_id: importId,
      source_records: [source()],
      mappings: [targetMapping],
      pilot_scope: pilotScope(),
      existing_parent_variant_gids: [targetMapping.target.parent_binding.variant_gid],
      existing_parent_bindings: [{
        bundle_definition_id: targetMapping.target.bundle_definition_id,
        product_gid: targetMapping.target.parent_binding.product_gid,
        variant_gid: targetMapping.target.parent_binding.variant_gid,
      }],
    });

    expect(plan.summary.ready_for_confirmation).toBe(1);
    expect(plan.records[0].existing_target).toBe(true);
    expect(plan.records[0].issues.map((item) => item.code)).not.toContain("EXISTING_PARENT_BINDING");
  });

  it("bounds every record to the approved store pilot series and parent Variant", () => {
    const plan = createPrebuiltBundleImportPlan({
      import_id: importId,
      source_records: [source({ product_series_key: "other-series" })],
      mappings: [mapping()],
      pilot_scope: pilotScope(),
    });
    expect(plan.records[0].issues.map((item) => item.code)).toContain("OUTSIDE_PILOT_SERIES");
  });

  it("returns deterministic plans for large source batches without applying writes", () => {
    const records = Array.from({ length: 1000 }, (_, index) => source({
      source_bundle_id: `legacy-${String(index).padStart(4, "0")}`,
    }));
    const mappings = records.map((record) => mapping({
      source_identity: `${record.source_system}:${record.source_bundle_id}`,
    }));
    const first = createPrebuiltBundleImportPlan({ import_id: importId, source_records: records, mappings, pilot_scope: pilotScope() });
    const second = createPrebuiltBundleImportPlan({ import_id: importId, source_records: records, mappings, pilot_scope: pilotScope() });
    expect(first.confirmation_token).toBe(second.confirmation_token);
    expect(first.summary.total).toBe(1000);
    expect(first.summary.ready_for_confirmation).toBe(1);
    expect(first.summary.rejected).toBe(999);
  });

  it("validates the pilot scope before any later Shopify product-series lookup", () => {
    expect(validatePilotScope(pilotScope())).toEqual([]);
    expect(validatePilotScope(pilotScope({ approved_parent_variant_gids: [] })))
      .toContain("pilot_scope.approved_parent_variant_gids must be a non-empty array");

    const plan = createPrebuiltBundleImportPlan({
      import_id: importId,
      source_records: [source()],
      mappings: [mapping()],
      pilot_scope: pilotScope({ approved_parent_variant_gids: [] }),
    });
    expect(plan.plan_issues.map((item) => item.code)).toContain("INVALID_PILOT_SCOPE");
  });
});
