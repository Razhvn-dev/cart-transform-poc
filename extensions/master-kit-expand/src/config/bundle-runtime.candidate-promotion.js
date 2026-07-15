import { parseRuntimeSnapshotMetafield } from "./bundle-runtime.extraction.js";
import { buildResolvedRuntimeSnapshotFunctionResult } from "./bundle-runtime.resolved-candidate-result.js";
import { comparePreparedFunctionResults } from "./bundle-runtime.result-comparator.js";
import { resolveValidatedRuntimeBundleSelection } from "./bundle-runtime.resolver.js";
import { assertRuntimeSnapshotMetafieldSize } from "./bundle-runtime.snapshot-size.js";
import { validateRuntimeSnapshot } from "./bundle-runtime.validator.js";

export function promoteRuntimeSnapshotCandidate(
  input,
  hardcodedResult,
  dependencies = {},
) {
  const prepare = dependencies.prepare ?? prepareRuntimeSnapshotCandidates;
  const build = dependencies.build ?? buildResolvedRuntimeSnapshotFunctionResult;
  const compare = dependencies.compare ?? comparePreparedFunctionResults;

  try {
    const prepared = prepare(input, dependencies);
    if (!prepared.ok) return fallback(hardcodedResult, prepared.reason);

    const candidateResult = build(prepared.snapshots);
    const comparison = compare(hardcodedResult, candidateResult);
    if (!comparison.match || comparison.differences.length > 0) {
      return fallback(hardcodedResult, "parity_mismatch", comparison);
    }

    return {
      promoted: true,
      result: candidateResult,
      comparison,
    };
  } catch {
    return fallback(hardcodedResult, "candidate_exception");
  }
}

export function prepareRuntimeSnapshotCandidates(input, dependencies = {}) {
  const parse = dependencies.parse ?? parseRuntimeSnapshotMetafield;
  const validate = dependencies.validate ?? validateRuntimeSnapshot;
  const resolve = dependencies.resolve ?? resolveValidatedRuntimeBundleSelection;
  const sizeGuard = dependencies.sizeGuard ?? assertRuntimeSnapshotMetafieldSize;
  const preparedSnapshots = [];

  for (const cartLine of input.cart?.lines || []) {
    const metafield = cartLine.merchandise?.product?.runtimeSnapshotDevMetafield;
    if (!metafield) continue;

    const size = sizeGuard(metafield);
    if (!size.ok) return { ok: false, reason: size.reason };

    const snapshot = parse(metafield);
    if (!snapshot) return { ok: false, reason: "invalid_snapshot" };
    if (validate(snapshot).length > 0) {
      return { ok: false, reason: "invalid_snapshot" };
    }

    let resolvedCandidate;
    try {
      resolvedCandidate = resolve(snapshot, selectionsByCartAttribute(cartLine, snapshot));
    } catch {
      return { ok: false, reason: "resolver_failed" };
    }

    preparedSnapshots.push({ cartLine, snapshot, resolvedCandidate });
  }

  return preparedSnapshots.length > 0
    ? { ok: true, snapshots: preparedSnapshots }
    : { ok: false, reason: "missing_snapshot" };
}

function fallback(result, fallbackReason, comparison = undefined) {
  return {
    promoted: false,
    result,
    fallbackReason,
    ...(comparison ? { comparison } : {}),
  };
}

function selectionsByCartAttribute(cartLine, snapshot) {
  return snapshot.groups.reduce((selections, group) => {
    selections[group.cart_attribute] =
      cartLine[cartLineFieldForAttribute(group.cart_attribute)]?.value;
    return selections;
  }, {});
}

function cartLineFieldForAttribute(attribute) {
  return attribute
    .replace(/^_builder_/, "builder_")
    .replace(/^_/, "")
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
