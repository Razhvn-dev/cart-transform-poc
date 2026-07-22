import { findUnsupportedFunctionResultShape } from "./bundle-runtime.result-comparator.js";
import { clonePrebuiltBundleRuntimeValue } from "./prebuilt-bundle-runtime.clone.js";

/**
 * Promotes only complete pre-built operations. Shared Core stays immutable and
 * is always the fallback for every incomplete or unsupported candidate.
 */
export function promotePrebuiltBundleRuntimeCandidate(hardcodedResult, candidate) {
  const hardcodedOperations = hardcodedResult?.operations;
  const candidateOperations = candidate?.result?.operations;
  const issues = [
    ...findUnsupportedFunctionResultShape(hardcodedResult, "hardcoded"),
  ];

  if (
    !isPrebuiltBundleRuntimeCandidateComplete(candidate) ||
    !Array.isArray(hardcodedOperations) ||
    issues.length > 0 ||
    hasExpandCartLineConflict(hardcodedOperations, candidateOperations)
  ) {
    return cloneFunctionResult(hardcodedResult);
  }

  const reusableCandidateOperations = Object.isFrozen(candidate?.result)
    && Object.isFrozen(candidateOperations);

  return deepFreeze({
    operations: [
      ...hardcodedOperations.map((operation) => clonePrebuiltBundleRuntimeValue(operation)),
      ...(reusableCandidateOperations
        ? candidateOperations
        : candidateOperations.map((operation) => clonePrebuiltBundleRuntimeValue(operation))),
    ],
  });
}

export function isPrebuiltBundleRuntimeCandidateComplete(candidate) {
  const candidateOperations = candidate?.result?.operations;
  const validMetadataCount = Number.isInteger(candidate?.valid_metadata_count)
    ? candidate.valid_metadata_count
    : (candidate?.metadata_observations || []).filter(
        ({ observation }) => observation?.status === "valid",
      ).length;
  const preparedCount = Number.isInteger(candidate?.prepared_candidate_count)
    ? candidate.prepared_candidate_count
    : candidate?.prepared_candidates?.length;
  const issues = [
    ...(candidate?.operation_shape_issues || []),
    ...findUnsupportedFunctionResultShape(candidate?.result, "snapshot"),
  ];

  return candidate?.status === "ready"
    && Array.isArray(candidateOperations)
    && Number.isInteger(preparedCount)
    && validMetadataCount > 0
    && candidateOperations.length === validMetadataCount
    && candidateOperations.length === preparedCount
    && issues.length === 0
    && !hasExpandCartLineConflict([], candidateOperations);
}

export function getPrebuiltCandidateCartLineIds(candidate) {
  if (!isPrebuiltBundleRuntimeCandidateComplete(candidate)) return new Set();
  return new Set(candidate.result.operations.map((operation) => operation.expand.cartLineId));
}

function hasExpandCartLineConflict(hardcodedOperations, candidateOperations) {
  const seen = new Set();
  for (const operation of [...hardcodedOperations, ...candidateOperations]) {
    const cartLineId = operation?.expand?.cartLineId;
    if (typeof cartLineId !== "string" || cartLineId.length === 0) return true;
    if (seen.has(cartLineId)) return true;
    seen.add(cartLineId);
  }
  return false;
}

function cloneFunctionResult(result) {
  return deepFreeze({
    operations: Array.isArray(result?.operations)
      ? result.operations.map((operation) => clonePrebuiltBundleRuntimeValue(operation))
      : [],
  });
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.keys(value).forEach((key) => deepFreeze(value[key]));
  return Object.freeze(value);
}
