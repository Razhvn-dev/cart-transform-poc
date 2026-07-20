import { PREBUILT_BUNDLE_RUNTIME_CATALOG_SCHEMA_VERSION } from "./prebuilt-bundle-runtime.catalog-lookup.js";
import { buildPrebuiltBundleRuntimeLocalCandidate } from "./prebuilt-bundle-runtime.local-candidate.js";
import { extractPrebuiltBundleRuntimeFunctionInput } from "./prebuilt-bundle-runtime.function-input.js";

/**
 * Dev-only composition for the pre-built candidate Function query shape.
 * Production does not import this module and remains on Shared Core.
 */
export function buildPrebuiltBundleRuntimeFunctionCandidate(input) {
  const normalized = extractPrebuiltBundleRuntimeFunctionInput(input);
  const candidate = buildPrebuiltBundleRuntimeLocalCandidate({
    cart_lines: input?.cart?.lines,
    catalog: {
      schema_version: PREBUILT_BUNDLE_RUNTIME_CATALOG_SCHEMA_VERSION,
      status: "ready",
      entries: normalized.entries,
      unavailable: [],
    },
    snapshots_by_definition_id: normalized.snapshots_by_definition_id,
    include_diagnostics: false,
  });

  return candidate;
}
