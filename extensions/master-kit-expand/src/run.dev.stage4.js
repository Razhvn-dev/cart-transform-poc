import { observeRuntimeSnapshotInput } from "./config/bundle-runtime.extraction.js";
import { run as runHardcodedCartTransform } from "./run.core.js";

export function run(input) {
  observeRuntimeSnapshotInput(input);
  return runHardcodedCartTransform(input);
}
