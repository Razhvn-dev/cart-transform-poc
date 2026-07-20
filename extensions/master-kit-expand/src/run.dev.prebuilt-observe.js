import { extractPrebuiltBundleRuntimeFunctionInput } from "./config/prebuilt-bundle-runtime.function-input.js";
import { run as runHardcodedCartTransform } from "./run.core.js";

// First integration bisect layer: query and parse only; never return a pre-built candidate.
export function run(input) {
  extractPrebuiltBundleRuntimeFunctionInput(input);
  return runHardcodedCartTransform(input);
}
