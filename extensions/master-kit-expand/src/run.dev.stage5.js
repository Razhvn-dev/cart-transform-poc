import { observeRuntimeSnapshotValidation } from "./config/bundle-runtime.validation-observation.js";
import { run as runHardcodedCartTransform } from "./run.core.js";

export function run(input) {
  observeRuntimeSnapshotValidation(input);
  return runHardcodedCartTransform(input);
}
