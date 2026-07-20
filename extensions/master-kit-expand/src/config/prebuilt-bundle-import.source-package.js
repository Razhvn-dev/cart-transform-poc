import { parsePrebuiltBundleImportPackage } from "./prebuilt-bundle-import.package.js";
import { collectPrebuiltBundleImportSourceRecords } from "./prebuilt-bundle-import.source-adapter.js";

/**
 * Builds a validated portable import package from a read-only source adapter.
 * Mapping and pilot approval remain explicit operator-supplied inputs.
 */
export async function createPrebuiltBundleImportPackageFromSource({
  adapter,
  import_id,
  mappings,
  pilot_scope,
  source_export = null,
  page_size,
  max_records,
} = {}) {
  const source_records = await collectPrebuiltBundleImportSourceRecords({
    adapter,
    page_size,
    max_records,
  });

  return parsePrebuiltBundleImportPackage({
    schema_version: "prebuilt_bundle_import_package.v1",
    import_id,
    source_records,
    mappings,
    pilot_scope,
    source_export: source_export ?? adapter?.source_export ?? {
      source_system: adapter?.source_system ?? null,
      collection_mode: "read_only_pagination",
    },
  });
}
