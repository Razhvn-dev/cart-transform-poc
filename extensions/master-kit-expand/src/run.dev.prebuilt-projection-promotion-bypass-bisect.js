import { getPrebuiltCandidateCartLineIds } from "./config/prebuilt-bundle-runtime.candidate-promotion.js";
import { buildPrebuiltBundleProjectionFunctionCandidate } from "./config/prebuilt-bundle-projection.function-candidate.js";
import { run as runHardcodedCartTransform } from "./run.core.js";

// Development-only single-variable bisect. Candidate construction, Metadata
// V1 attributes, fixed prices, and Shared Core isolation remain unchanged; only
// the promotion helper's second clone/deep-freeze traversal is bypassed.
export function run(input) {
  const candidate = buildPrebuiltBundleProjectionFunctionCandidate(input);
  const prebuiltCartLineIds = getPrebuiltCandidateCartLineIds(candidate);
  if (prebuiltCartLineIds.size === 0) return runHardcodedCartTransform(input);

  const hardcodedResult = runHardcodedCartTransform({
    ...input,
    cart: {
      ...input.cart,
      lines: input.cart.lines.filter((line) => !prebuiltCartLineIds.has(line.id)),
    },
  });

  return {
    operations: [
      ...(hardcodedResult.operations ?? []),
      ...candidate.result.operations,
    ],
  };
}
