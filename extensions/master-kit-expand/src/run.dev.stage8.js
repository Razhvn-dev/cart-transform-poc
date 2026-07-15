import { promoteRuntimeSnapshotCandidate } from "./config/bundle-runtime.candidate-promotion.js";
import { run as runHardcodedCartTransform } from "./run.core.js";

export function run(input) {
  const hardcodedResult = runHardcodedCartTransform(input);
  return promoteRuntimeSnapshotCandidate(input, hardcodedResult).result;
}
