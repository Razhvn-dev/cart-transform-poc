import { observeRuntimeSnapshotResolution } from "./config/bundle-runtime.resolution-observation.js";
import { run as runHardcodedCartTransform } from "./run.core.js";

export function run(input) {
  observeRuntimeSnapshotResolution(input);
  return runHardcodedCartTransform(input);
}
