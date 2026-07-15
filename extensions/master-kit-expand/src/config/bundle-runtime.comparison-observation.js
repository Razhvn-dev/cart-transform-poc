import { buildResolvedRuntimeSnapshotFunctionResult } from "./bundle-runtime.resolved-candidate-result.js";
import { comparePreparedFunctionResults } from "./bundle-runtime.result-comparator.js";

export function observeRuntimeSnapshotComparison(hardcodedResult, preparedSnapshots) {
  try {
    if (!preparedSnapshots?.length) return null;

    const candidateResult = buildResolvedRuntimeSnapshotFunctionResult(preparedSnapshots);
    return comparePreparedFunctionResults(hardcodedResult, candidateResult);
  } catch {
    return null;
  }
}
