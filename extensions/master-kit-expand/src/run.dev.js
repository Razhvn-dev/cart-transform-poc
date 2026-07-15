import { run as runHardcodedCartTransform } from "./run.core.js";
import { runDevOnlyRuntimeSnapshot } from "./config/bundle-runtime.dev-shadow.js";

const DEPLOYED_DEV_RUNTIME_MODE = "candidate";

export function run(input) {
  const hardcodedResult = runHardcodedCartTransform(input);

  try {
    return runDevOnlyRuntimeSnapshot(input, hardcodedResult, {
      runtimeMode: DEPLOYED_DEV_RUNTIME_MODE,
    }).result;
  } catch {
    // Dev-only shadow data must never affect cart or checkout output.
    return hardcodedResult;
  }
}
