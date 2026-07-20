import { extractPrebuiltBundleRuntimeFunctionInput } from "./config/prebuilt-bundle-runtime.function-input.js";
import { run as runStaticProbe } from "./run.dev.prebuilt-static-probe.js";

// Development-only hosted bisect: execute the real server-input extraction
// path, then return the already-proven static expand result.
export function run(input) {
  extractPrebuiltBundleRuntimeFunctionInput(input);
  return runStaticProbe(input);
}
