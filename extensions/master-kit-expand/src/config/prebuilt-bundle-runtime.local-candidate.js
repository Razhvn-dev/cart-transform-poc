import { findPrebuiltBundleRuntimeMapping } from "./prebuilt-bundle-runtime.catalog-lookup.js";
import { preparePrebuiltBundleRuntimeSelections } from "./prebuilt-bundle-runtime.preparation.js";
import { buildPrebuiltBundleFunctionResult } from "./prebuilt-bundle-runtime.result.js";
import { findUnsupportedFunctionResultShape } from "./bundle-runtime.result-comparator.js";
import { observePrebuiltBundleCartMetadata } from "./prebuilt-bundle-cart-metadata.observation.js";
import { clonePrebuiltBundleRuntimeValue } from "./prebuilt-bundle-runtime.clone.js";

/**
 * Composes the dev-only pre-built SKU candidate path from a server-owned
 * catalog/Snapshot map and validated Bundle Metadata V1 correlation input.
 */
export function buildPrebuiltBundleRuntimeLocalCandidate({
  cart_lines,
  catalog,
  snapshots_by_definition_id,
  include_diagnostics = true,
} = {}) {
  const cartLines = Array.isArray(cart_lines) ? cart_lines : [];
  const metadataObservations = cartLines.map((cartLine) => ({
    cart_line_id: cartLine?.id ?? null,
    observation: observePrebuiltBundleCartMetadata(cartLine),
  }));
  rejectDuplicateBundleInstanceIds(metadataObservations);
  const eligibleLines = cartLines.filter((cartLine, index) => (
    metadataObservations[index].observation.status === "valid"
  ));
  const prepared = preparePrebuiltBundleRuntimeSelections(eligibleLines, {
    lookupMapping: (parentVariantGid) => findPrebuiltBundleRuntimeMapping(catalog, parentVariantGid),
    lookupSnapshot: (mapping) => snapshots_by_definition_id?.[mapping.bundle_definition_id] ?? null,
    lookupBundleMetadata: (cartLine) => metadataObservations.find(
      (item) => item.cart_line_id === cartLine.id,
    )?.observation?.metadata ?? null,
  });
  const result = buildPrebuiltBundleFunctionResult(prepared);
  const operationShapeIssues = findUnsupportedFunctionResultShape(result);

  const summary = {
    status: operationShapeIssues.length === 0 ? "ready" : "invalid",
    valid_metadata_count: metadataObservations.filter(
      ({ observation }) => observation.status === "valid",
    ).length,
    prepared_candidate_count: prepared.length,
    result,
    operation_shape_issues: operationShapeIssues,
  };

  if (!include_diagnostics) return deepFreeze(summary);
  return deepFreeze({
    ...summary,
    metadata_observations: metadataObservations.map((item) => clonePrebuiltBundleRuntimeValue(item)),
    prepared_candidates: prepared.map((candidate) => clonePrebuiltBundleRuntimeValue(candidate)),
  });
}

// A bundle instance ID correlates one parent Cart line only. If a client or
// theme bug reuses it, neither line may become a future pre-built candidate.
function rejectDuplicateBundleInstanceIds(metadataObservations) {
  const occurrences = new Map();
  metadataObservations.forEach((item, index) => {
    const bundleInstanceId = item.observation?.metadata?.bundle_instance_id;
    if (item.observation?.status !== "valid" || typeof bundleInstanceId !== "string") return;
    const indexes = occurrences.get(bundleInstanceId) ?? [];
    indexes.push(index);
    occurrences.set(bundleInstanceId, indexes);
  });

  occurrences.forEach((indexes) => {
    if (indexes.length < 2) return;
    indexes.forEach((index) => {
      metadataObservations[index].observation = deepFreeze({
        status: "invalid",
        reason: "BUNDLE_INSTANCE_ID_DUPLICATE",
        metadata: null,
      });
    });
  });
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.keys(value).forEach((key) => deepFreeze(value[key]));
  return Object.freeze(value);
}
