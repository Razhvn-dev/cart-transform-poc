import {
  buildPrebuiltBundleProjectionFunctionCandidate,
  buildSinglePrebuiltBundleProjectionFunctionResult,
} from "./config/prebuilt-bundle-projection.function-candidate.js";
import {
  getPrebuiltCandidateCartLineIds,
  promotePrebuiltBundleRuntimeCandidate,
} from "./config/prebuilt-bundle-runtime.candidate-promotion.js";
import { run as runHardcodedCartTransform } from "./run.core.js";

// Dev-only generic projection profile. Production remains on run.core.js.
export function run(input) {
  const singleResult = buildSinglePrebuiltBundleProjectionFunctionResult(input);
  if (singleResult && singleResult.operations.length === 1) return singleResult;

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
  return promotePrebuiltBundleRuntimeCandidate(hardcodedResult, candidate);
}
