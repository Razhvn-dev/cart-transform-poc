import { masterKitConfigV1 } from "../../../extensions/master-kit-expand/src/config/fixtures/master-kit-config.v1.js";

export const PREBUILT_IMPORT_DEMO_NOTICE = "Synthetic ACES demo data. Review only; no Shopify writes.";

export function createPrebuiltImportDemoData() {
  const configuration = structuredClone(masterKitConfigV1);
  const sourceSystem = "aces_demo_paid_bundles";
  const sourceBundleId = "demo-master-kit-001";
  const productSeriesKey = "master-kit-demo";
  const defaultComponents = configuration.component_groups
    .filter((group) => group.group_key !== "display")
    .map((group) => {
      const option = group.options.find((candidate) => candidate.option_key === group.default_option_key);
      if (!option?.variant_gid) throw new Error(`Demo configuration is missing the default Variant for ${group.group_key}`);
      return { variant_gid: option.variant_gid, quantity: 1 };
    });

  return Object.freeze({
    notice: PREBUILT_IMPORT_DEMO_NOTICE,
    import_id: "99990000-0000-4000-8000-000000000101",
    raw_source_export: {
      payload: {
        bundles: [{
          external: { id: sourceBundleId, checksum: "synthetic-demo-checksum-v1" },
          series: { key: productSeriesKey },
          parent: {
            product_gid: configuration.parent.product_gid,
            variant_gid: configuration.parent.variant_gid,
          },
          items: defaultComponents.map((component) => ({
            shopify: { variant_gid: component.variant_gid },
            quantity: component.quantity,
          })),
        }],
      },
    },
    source_mapping_profile: {
      schema_version: "prebuilt_bundle_source_mapping.v1",
      source_system: sourceSystem,
      records_path: "payload.bundles",
      fields: {
        source_bundle_id: "external.id",
        source_checksum: "external.checksum",
        product_series_key: "series.key",
        parent_product_gid: "parent.product_gid",
        parent_variant_gid: "parent.variant_gid",
      },
      components: {
        path: "items",
        variant_gid: "shopify.variant_gid",
        quantity: "quantity",
        default_quantity: 1,
      },
    },
    mappings: [{
      schema_version: "prebuilt_bundle_import_mapping.v1",
      source_identity: `${sourceSystem}:${sourceBundleId}`,
      target: {
        bundle_definition_id: configuration.configuration_id,
        parent_binding: structuredClone(configuration.parent),
      },
      configuration,
      fixed_selections: Object.fromEntries(configuration.component_groups.map((group) => [
        group.group_key,
        group.default_option_key,
      ])),
    }],
    pilot_scope: {
      schema_version: "prebuilt_bundle_pilot_scope.v1",
      pilot_scope_id: "99990000-0000-4000-8000-000000000102",
      store_domain: "huang-mvqquz1p.myshopify.com",
      approved_product_series_keys: [productSeriesKey],
      approved_parent_variant_gids: [configuration.parent.variant_gid],
    },
  });
}
