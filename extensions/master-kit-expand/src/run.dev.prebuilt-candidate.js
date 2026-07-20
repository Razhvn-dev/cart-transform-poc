import {
  getPrebuiltCandidateCartLineIds,
  promotePrebuiltBundleRuntimeCandidate,
} from "./config/prebuilt-bundle-runtime.candidate-promotion.js";
import { buildPrebuiltBundleRuntimeFunctionCandidate } from "./config/prebuilt-bundle-runtime.function-candidate.js";
import { run as runHardcodedCartTransform } from "./run.core.js";

// Dev-only final integration profile. Production keeps using run.core.js directly.
export function run(input) {
  const candidate = buildPrebuiltBundleRuntimeFunctionCandidate(input);
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
