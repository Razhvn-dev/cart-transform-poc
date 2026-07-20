import { buildPrebuiltBundleRuntimeFunctionCandidate } from "./config/prebuilt-bundle-runtime.function-candidate.js";
import { run as runHardcodedCartTransform } from "./run.core.js";

// Second integration bisect layer: resolve a complete pre-built candidate, but never return it.
export function run(input) {
  buildPrebuiltBundleRuntimeFunctionCandidate(input);
  return runHardcodedCartTransform(input);
}
