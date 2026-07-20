import { masterKitConfigV1 } from "../extensions/master-kit-expand/src/config/fixtures/master-kit-config.v1.js";
import {
  PREBUILT_BUNDLE_IMPORT_MAPPING_SCHEMA_VERSION,
  PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION,
  PREBUILT_BUNDLE_PILOT_SCOPE_SCHEMA_VERSION,
} from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.plan.js";
import { PREBUILT_BUNDLE_IMPORT_PACKAGE_SCHEMA_VERSION } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.package.js";

export const DEV_PREBUILT_IMPORT_REHEARSAL_TARGET = Object.freeze({
  appConfig: "shopify.app.dev.toml",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
});

export const DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS = Object.freeze({
  metaobjectTypes: Object.freeze({
    bundleDefinition: "$app:aces_bundle_definition_dev",
    bundleRevision: "$app:aces_bundle_revision_dev",
    publicationRecord: "$app:aces_bundle_publication_record_dev",
  }),
  documentFieldKey: "document",
  metafields: Object.freeze({
    namespace: "aces_dev",
    runtimeSnapshotKey: "bundle_runtime_snapshot_import_rehearsal_v1",
    prebuiltExpandProjectionKey: "prebuilt_expand_projection_import_rehearsal_v1",
    activeRevisionKey: "active_revision_id_import_rehearsal_v1",
    prebuiltImportLedgerKeyPrefix: "prebuilt_import_rehearsal_v1_",
  }),
});

export const DEV_PREBUILT_IMPORT_REHEARSAL_RUNS = Object.freeze({
  success: Object.freeze({
    importId: "a9011d4e-5a14-4e0d-9000-000000000060",
    pilotScopeId: "a9011d4e-5a14-4e0d-9000-000000000061",
    definitionId: "a9011d4e-5a14-4e0d-9000-000000000062",
    sourceBundleId: "dev-import-rehearsal-success-v4",
    revisionId: "a9011d4e-5a14-4e0d-9000-000000000063",
    publicationId: "a9011d4e-5a14-4e0d-9000-000000000064",
  }),
  partial: Object.freeze({
    importId: "a9011d4e-5a14-4e0d-9000-000000000030",
    pilotScopeId: "a9011d4e-5a14-4e0d-9000-000000000031",
    definitionId: "a9011d4e-5a14-4e0d-9000-000000000032",
    sourceBundleId: "dev-import-rehearsal-success-v2",
    revisionId: "a9011d4e-5a14-4e0d-9000-000000000053",
    publicationId: "a9011d4e-5a14-4e0d-9000-000000000054",
  }),
});

export function assertDevPrebuiltImportRehearsalBindings(bindings = DEV_PREBUILT_IMPORT_REHEARSAL_BINDINGS) {
  const metafields = bindings?.metafields;
  if (metafields?.namespace !== "aces_dev") throw new Error("rehearsal namespace must be aces_dev");
  const keys = [
    metafields.runtimeSnapshotKey,
    metafields.prebuiltExpandProjectionKey,
    metafields.activeRevisionKey,
  ];
  if (keys.some((key) => typeof key !== "string" || !key.includes("import_rehearsal"))) {
    throw new Error("all pre-built import rehearsal carriers must be isolated");
  }
  if (typeof metafields.prebuiltImportLedgerKeyPrefix !== "string"
    || !metafields.prebuiltImportLedgerKeyPrefix.includes("import_rehearsal")) {
    throw new Error("pre-built import rehearsal ledger prefix must be isolated");
  }
  return bindings;
}

export function createDevPrebuiltImportRehearsalPackage({ run, parent }) {
  if (!run?.importId || !run?.pilotScopeId || !run?.definitionId || !run?.sourceBundleId) {
    throw new Error("a complete pre-built import rehearsal run is required");
  }
  if (!parent?.product_gid || !parent?.variant_gid || !parent?.sku || !parent?.title || !parent?.template_handle) {
    throw new Error("a complete existing Shopify parent binding is required");
  }
  const configuration = structuredClone(masterKitConfigV1);
  configuration.configuration_id = run.definitionId;
  configuration.slug = `dev-import-rehearsal-${run.definitionId.slice(-2)}`;
  configuration.internal_name = `Dev import rehearsal ${run.definitionId.slice(-2)}`;
  configuration.parent = {
    ...configuration.parent,
    ...structuredClone(parent),
    variant_selection_strategy: "fixed",
  };
  const fixedSelections = Object.fromEntries(configuration.component_groups.map((group) => [
    group.group_key,
    group.default_option_key,
  ]));
  const components = configuration.component_groups
    .filter((group) => group.group_key !== "display")
    .map((group) => ({
      variant_gid: group.options.find((option) => option.option_key === group.default_option_key).variant_gid,
      quantity: 1,
    }));
  const parentBinding = structuredClone(configuration.parent);
  return {
    schema_version: PREBUILT_BUNDLE_IMPORT_PACKAGE_SCHEMA_VERSION,
    import_id: run.importId,
    source_export: { source_system: "aces_dev_rehearsal", exported_at: "2026-07-20T00:00:00Z" },
    source_records: [{
      schema_version: PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION,
      source_system: "aces_dev_rehearsal",
      source_bundle_id: run.sourceBundleId,
      source_checksum: `${run.sourceBundleId}-checksum`,
      product_series_key: "dev-import-rehearsal",
      parent_binding: parentBinding,
      components,
    }],
    mappings: [{
      schema_version: PREBUILT_BUNDLE_IMPORT_MAPPING_SCHEMA_VERSION,
      source_identity: `aces_dev_rehearsal:${run.sourceBundleId}`,
      target: { bundle_definition_id: run.definitionId, parent_binding: parentBinding },
      configuration,
      fixed_selections: fixedSelections,
    }],
    pilot_scope: {
      schema_version: PREBUILT_BUNDLE_PILOT_SCOPE_SCHEMA_VERSION,
      pilot_scope_id: run.pilotScopeId,
      store_domain: DEV_PREBUILT_IMPORT_REHEARSAL_TARGET.store,
      approved_product_series_keys: ["dev-import-rehearsal"],
      approved_parent_variant_gids: [parent.variant_gid],
    },
  };
}

export function excludedComponentProductGids() {
  return new Set([
    masterKitConfigV1.parent.product_gid,
    ...masterKitConfigV1.component_groups.flatMap((group) => group.options.map((option) => option.product_gid)),
  ]);
}
