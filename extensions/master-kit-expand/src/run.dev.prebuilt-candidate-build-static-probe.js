import { buildPrebuiltBundleRuntimeFunctionCandidate } from "./config/prebuilt-bundle-runtime.function-candidate.js";
import { run as runStaticProbe } from "./run.dev.prebuilt-static-probe.js";

// Development-only hosted bisect: execute the complete pre-built candidate
// construction path, then return the already-proven static expand result.
// The candidate cannot become runtime authority through this entry.
export function run(input) {
  buildPrebuiltBundleRuntimeFunctionCandidate(input);
  return runStaticProbe(input);
}
