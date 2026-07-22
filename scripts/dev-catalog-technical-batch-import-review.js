import { createHash } from "node:crypto";

import { createPrebuiltBundleImportPlanFromPackage } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.package.js";

export function prepareDevCatalogTechnicalBatchImportReview({ drafts, readiness, collisions, scope } = {}) {
  if (drafts?.batch_id !== scope?.batch_id || readiness?.batch_id !== scope?.batch_id || collisions?.batch_id !== scope?.batch_id) {
    throw new Error("technical batch evidence does not match import scope");
  }
  if (collisions.summary?.blocked > 0) throw new Error("collision readback contains blocked records");
  const readinessBySku = new Map(readiness.records.map((record) => [record.parent_sku, record]));
  const assignments = scope.dev_product_series_assignments ?? {};
  const draftRecords = drafts.records.filter((record) => record.status === "draft_ready");
  const missingAssignments = draftRecords.filter((record) => !assignments[record.parent_sku]).map((record) => record.parent_sku);
  if (missingAssignments.length > 0) throw new Error(`development product series assignment required: ${missingAssignments.join(", ")}`);
  const sourceSystem = "bundles_app_catalog_dev_technical_batch";
  const packageValue = {
    schema_version: "prebuilt_bundle_import_package.v1",
    import_id: stableUuid(`${scope.batch_id}:import`),
    source_export: {
      source_system: sourceSystem,
      collection_mode: "explicit_dev_technical_batch_after_live_readback",
      batch_id: scope.batch_id,
    },
    source_records: draftRecords.map((record) => {
      const configuration = record.draft.revision.configuration;
      const local = readinessBySku.get(record.parent_sku);
      return {
        schema_version: "prebuilt_bundle_import_source.v1",
        source_system: sourceSystem,
        source_bundle_id: record.parent_sku,
        source_checksum: local.evidence.source_checksum,
        product_series_key: assignments[record.parent_sku],
        parent_binding: structuredClone(record.draft.definition.parent_binding),
        components: configuration.component_groups
          .filter((group) => group.group_key !== "display")
          .map((group) => ({ variant_gid: group.options[0].variant_gid, quantity: 1 })),
      };
    }),
    mappings: draftRecords.map((record) => {
      const configuration = structuredClone(record.draft.revision.configuration);
      configuration.status = "active";
      configuration.audit = {
        ...configuration.audit,
        published_by: scope.draft_created_by,
        published_at: scope.draft_created_at,
      };
      return {
        schema_version: "prebuilt_bundle_import_mapping.v1",
        source_identity: `${sourceSystem}:${record.parent_sku}`,
        target: { bundle_definition_id: record.draft.definition.bundle_definition_id, parent_binding: structuredClone(record.draft.definition.parent_binding) },
        configuration,
        fixed_selections: Object.fromEntries(configuration.component_groups.map((group) => [group.group_key, group.default_option_key])),
      };
    }),
    pilot_scope: {
      schema_version: "prebuilt_bundle_pilot_scope.v1",
      pilot_scope_id: stableUuid(`${scope.batch_id}:pilot-scope`),
      store_domain: "huang-mvqquz1p.myshopify.com",
      approved_product_series_keys: [...new Set(draftRecords.map((record) => assignments[record.parent_sku]))].sort(),
      approved_parent_variant_gids: draftRecords.map((record) => record.draft.definition.parent_binding.variant_gid).sort(),
    },
  };
  const planned = createPrebuiltBundleImportPlanFromPackage(packageValue);
  if (!planned.ok) throw new Error(planned.errors.join("; "));
  return {
    schema_version: "dev_catalog_technical_batch_import_review.v1",
    mode: "local_dry_run",
    batch_id: scope.batch_id,
    package_fingerprint: planned.fingerprint,
    import_package: packageValue,
    plan: planned.plan,
    shopify_writes_performed: false,
  };
}

function stableUuid(seed) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
