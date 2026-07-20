import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import {
  PREBUILT_BUNDLE_IMPORT_MAPPING_SCHEMA_VERSION,
  PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION,
  PREBUILT_BUNDLE_PILOT_SCOPE_SCHEMA_VERSION,
} from "./prebuilt-bundle-import.plan.js";
import { PREBUILT_BUNDLE_IMPORT_PACKAGE_SCHEMA_VERSION } from "./prebuilt-bundle-import.package.js";

export function importFixture() {
  const configuration = structuredClone(masterKitConfigV1);
  const parent_binding = structuredClone(configuration.parent);
  return {
    schema_version: PREBUILT_BUNDLE_IMPORT_PACKAGE_SCHEMA_VERSION,
    import_id: "99990000-0000-4000-8000-000000000001",
    source_export: { source_system: "legacy_paid_app", exported_at: "2026-07-17T00:00:00Z" },
    source_records: [{
      schema_version: PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION,
      source_system: "legacy_paid_app",
      source_bundle_id: "legacy-master-kit-1",
      source_checksum: "legacy-checksum-1",
      product_series_key: "master-kit",
      parent_binding,
      components: configuration.component_groups
        .filter((group) => group.group_key !== "display")
        .map((group) => ({
        variant_gid: group.options.find((option) => option.option_key === group.default_option_key).variant_gid,
        quantity: 1,
        })),
    }],
    mappings: [{
      schema_version: PREBUILT_BUNDLE_IMPORT_MAPPING_SCHEMA_VERSION,
      source_identity: "legacy_paid_app:legacy-master-kit-1",
      target: {
        bundle_definition_id: configuration.configuration_id,
        parent_binding,
      },
      configuration,
      fixed_selections: Object.fromEntries(configuration.component_groups.map((group) => [group.group_key, group.default_option_key])),
    }],
    pilot_scope: {
      schema_version: PREBUILT_BUNDLE_PILOT_SCOPE_SCHEMA_VERSION,
      pilot_scope_id: "99990000-0000-4000-8000-000000000002",
      store_domain: "huang-mvqquz1p.myshopify.com",
      approved_product_series_keys: ["master-kit"],
      approved_parent_variant_gids: [parent_binding.variant_gid],
    },
  };
}
