import { clonePrebuiltBundleRuntimeValue } from "./prebuilt-bundle-runtime.clone.js";

// This module is deliberately dependency-light: it is safe for the hosted
// Function candidate path and does not import catalog compilation code.
export const PREBUILT_BUNDLE_RUNTIME_CATALOG_SCHEMA_VERSION = "prebuilt_bundle_runtime_catalog.v1";

export function findPrebuiltBundleRuntimeMapping(catalog, parentVariantGid) {
  if (catalog?.schema_version !== PREBUILT_BUNDLE_RUNTIME_CATALOG_SCHEMA_VERSION) return null;
  if (!Array.isArray(catalog.entries)) return null;
  const mapping = catalog.entries.find((entry) => entry.parent_variant_gid === parentVariantGid);
  return mapping ? clonePrebuiltBundleRuntimeValue(mapping) : null;
}
