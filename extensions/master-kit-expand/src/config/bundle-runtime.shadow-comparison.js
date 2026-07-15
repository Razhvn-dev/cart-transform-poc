import { buildResolvedRuntimeSnapshotFunctionResult } from "./bundle-runtime.resolved-candidate-result.js";
import {
  comparePreparedFunctionResults,
  normalizeFunctionResult,
} from "./bundle-runtime.result-comparator.js";
import { resolveRuntimeBundleSelection } from "./bundle-runtime.resolver.js";

export { normalizeFunctionResult };

export function compareHardcodedToRuntimeSnapshot(input, options = {}) {
  const hardcodedResult = options.hardcodedResult ?? options.run?.(input);
  if (!hardcodedResult) {
    throw new Error("hardcodedResult or run option is required");
  }

  if (!options.snapshot) {
    throw new Error("snapshot is required");
  }

  return compareFunctionResultToRuntimeSnapshot(
    hardcodedResult,
    input,
    options.snapshot,
  );
}

export function compareFunctionResultToRuntimeSnapshot(
  hardcodedResult,
  input,
  snapshot,
) {
  return comparePreparedFunctionResults(
    hardcodedResult,
    buildSnapshotFunctionResult(input, snapshot),
  );
}

export function buildSnapshotFunctionResult(input, snapshot) {
  const preparedSnapshots = (input.cart?.lines || [])
    .filter((cartLine) =>
      cartLine.merchandise?.__typename === "ProductVariant" &&
      cartLine.merchandise.id === snapshot.parent.variant_gid
    )
    .map((cartLine) => ({
      cartLine,
      snapshot,
      resolvedCandidate: resolveRuntimeBundleSelection(
        snapshot,
        selectionsByCartAttribute(cartLine, snapshot),
      ),
    }));

  return buildResolvedRuntimeSnapshotFunctionResult(preparedSnapshots);
}

function selectionsByCartAttribute(cartLine, snapshot) {
  return snapshot.groups.reduce((selections, group) => {
    selections[group.cart_attribute] =
      cartLine[cartLineFieldForAttribute(group.cart_attribute)]?.value;
    return selections;
  }, {});
}

function cartLineFieldForAttribute(attribute) {
  return attribute
    .replace(/^_builder_/, "builder_")
    .replace(/^_/, "")
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
