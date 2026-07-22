import { buildPrebuiltBundleProjectionFunctionCandidate } from "./config/prebuilt-bundle-projection.function-candidate.js";
import { run as runStaticProbe } from "./run.dev.prebuilt-static-probe.js";

const DIAGNOSTIC_PARENT_VARIANT_IDS = new Set([
  "gid://shopify/ProductVariant/51592673329430",
  "gid://shopify/ProductVariant/51592717271318",
]);

// Development-only observable hosted bisect. It executes the complete compact
// Projection candidate, but the proven static payload remains the sole output
// authority. The Checkout title exposes only aggregate readiness counts.
export function run(input) {
  const candidate = buildPrebuiltBundleProjectionFunctionCandidate(input);
  const diagnosticLineIds = new Set((input?.cart?.lines ?? [])
    .filter((line) => DIAGNOSTIC_PARENT_VARIANT_IDS.has(line?.merchandise?.id))
    .map((line) => line.id));
  const marker = [
    "projection",
    candidate.status,
    candidate.valid_metadata_count,
    candidate.prepared_candidate_count,
  ].join(":");
  const staticResult = runStaticProbe(input);

  return {
    operations: (staticResult.operations ?? []).map((operation) => {
      if (!diagnosticLineIds.has(operation?.expand?.cartLineId)) return operation;
      return {
        expand: {
          ...operation.expand,
          title: `${operation.expand.title} [${marker}]`,
        },
      };
    }),
  };
}
