import { buildPrebuiltBundleRuntimeFunctionCandidate } from "./config/prebuilt-bundle-runtime.function-candidate.js";
import { run as runStaticProbe } from "./run.dev.prebuilt-static-probe.js";

// Development-only hosted bisect: retain the complete candidate module graph
// without executing candidate construction, then return the proven static
// expand result. This distinguishes module loading from candidate execution.
export function run(input) {
  if (typeof buildPrebuiltBundleRuntimeFunctionCandidate !== "function") {
    return { operations: [] };
  }
  return runStaticProbe(input);
}
