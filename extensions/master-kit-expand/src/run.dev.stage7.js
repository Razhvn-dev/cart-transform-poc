import { observeRuntimeSnapshotComparison } from "./config/bundle-runtime.comparison-observation.js";
import { observeRuntimeSnapshotResolution } from "./config/bundle-runtime.resolution-observation.js";
import { run as runHardcodedCartTransform } from "./run.core.js";

export function run(input) {
  const hardcodedResult = runHardcodedCartTransform(input);
  const preparedSnapshots = observeRuntimeSnapshotResolution(input);
  observeRuntimeSnapshotComparison(hardcodedResult, preparedSnapshots);
  return hardcodedResult;
}
