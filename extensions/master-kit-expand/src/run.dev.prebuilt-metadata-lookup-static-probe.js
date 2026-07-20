import { extractPrebuiltBundleRuntimeFunctionInput } from "./config/prebuilt-bundle-runtime.function-input.js";
import {
  findPrebuiltBundleRuntimeMapping,
  PREBUILT_BUNDLE_RUNTIME_CATALOG_SCHEMA_VERSION,
} from "./config/prebuilt-bundle-runtime.catalog-lookup.js";
import { observePrebuiltBundleCartMetadata } from "./config/prebuilt-bundle-cart-metadata.observation.js";
import { run as runStaticProbe } from "./run.dev.prebuilt-static-probe.js";

// Development-only hosted bisect: execute server-input extraction, Metadata V1
// observation, mapping lookup, and Snapshot lookup, but do not resolve selections
// or build a candidate result. The proven static expand remains the only output.
export function run(input) {
  const normalized = extractPrebuiltBundleRuntimeFunctionInput(input);
  const catalog = {
    schema_version: PREBUILT_BUNDLE_RUNTIME_CATALOG_SCHEMA_VERSION,
    status: "ready",
    entries: normalized.entries,
    unavailable: [],
  };
  let observationCount = normalized.observations.length;

  for (const line of input?.cart?.lines ?? []) {
    const metadata = observePrebuiltBundleCartMetadata(line);
    observationCount += metadata.status === "valid" ? 1 : 0;

    const variantId = line?.merchandise?.__typename === "ProductVariant"
      ? line.merchandise.id
      : null;
    const mapping = variantId
      ? findPrebuiltBundleRuntimeMapping(catalog, variantId)
      : null;
    const snapshot = mapping
      ? normalized.snapshots_by_definition_id[mapping.bundle_definition_id]
      : null;
    observationCount += snapshot ? 1 : 0;
  }

  return observationCount < 0 ? { operations: [] } : runStaticProbe(input);
}
