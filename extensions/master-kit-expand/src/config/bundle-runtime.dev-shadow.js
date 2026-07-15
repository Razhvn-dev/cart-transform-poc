import {
  buildSnapshotFunctionResult,
  compareFunctionResultToRuntimeSnapshot,
} from "./bundle-runtime.shadow-comparison.js";
import {
  RUNTIME_SNAPSHOT_HARD_LIMIT_BYTES,
  RUNTIME_SNAPSHOT_TARGET_BYTES,
  RUNTIME_SNAPSHOT_WARNING_BYTES,
  assertRuntimeSnapshotMetafieldSize,
} from "./bundle-runtime.snapshot-size.js";
import { assertValidRuntimeSnapshot } from "./bundle-runtime.validator.js";

export {
  RUNTIME_SNAPSHOT_HARD_LIMIT_BYTES,
  RUNTIME_SNAPSHOT_TARGET_BYTES,
  RUNTIME_SNAPSHOT_WARNING_BYTES,
  assertRuntimeSnapshotMetafieldSize,
};

export const DEV_RUNTIME_MODES = new Set(["hardcoded", "shadow", "candidate"]);
export const DEFAULT_DEV_RUNTIME_MODE = "shadow";

export function runDevOnlyRuntimeSnapshot(input, hardcodedResult, options = {}) {
  const mode = resolveDevRuntimeMode(options);

  if (mode === "hardcoded") {
    return {
      mode,
      promoted: false,
      result: hardcodedResult,
      fallbackReason: "mode_hardcoded",
    };
  }

  const promotion = evaluateRuntimeSnapshotPromotion(input, hardcodedResult);

  if (mode === "candidate" && promotion.promoted) {
    return {
      mode,
      promoted: true,
      result: promotion.snapshotResult,
      comparison: promotion.comparison,
    };
  }

  return {
    mode,
    promoted: false,
    result: hardcodedResult,
    comparison: promotion.comparison,
    fallbackReason: promotion.fallbackReason || "mode_shadow",
  };
}

export function runDevOnlyRuntimeSnapshotShadowComparison(input, hardcodedResult) {
  try {
    return evaluateRuntimeSnapshotPromotion(input, hardcodedResult).comparison ?? null;
  } catch {
    return null;
  }
}

export function evaluateRuntimeSnapshotPromotion(input, hardcodedResult) {
  let snapshotResult;
  try {
    snapshotResult = extractRuntimeSnapshotCandidate(input);
  } catch {
    return {
      promoted: false,
      fallbackReason: "invalid_snapshot",
    };
  }

  if (!snapshotResult.ok) {
    return {
      promoted: false,
      fallbackReason: snapshotResult.reason,
    };
  }

  try {
    assertValidRuntimeSnapshot(snapshotResult.snapshot);
  } catch {
    return {
      promoted: false,
      fallbackReason: "invalid_snapshot",
    };
  }

  const comparison = compareFunctionResultToRuntimeSnapshot(
    hardcodedResult,
    input,
    snapshotResult.snapshot,
  );

  if (!comparison.match) {
    return {
      promoted: false,
      comparison,
      fallbackReason: "parity_mismatch",
    };
  }

  return {
    promoted: true,
    comparison,
    snapshot: snapshotResult.snapshot,
    snapshotResult: buildSnapshotFunctionResult(input, snapshotResult.snapshot),
  };
}

export function extractRuntimeSnapshotCandidate(input) {
  for (const line of input.cart.lines || []) {
    const metafield = line.merchandise?.product?.runtimeSnapshotDevMetafield;
    const sizeCheck = assertRuntimeSnapshotMetafieldSize(metafield);
    if (!sizeCheck.ok) return sizeCheck;

    const snapshot = parseRuntimeSnapshotMetafield(metafield);
    if (snapshot) return { ok: true, snapshot };
  }

  return { ok: false, reason: "missing_snapshot" };
}

export function extractRuntimeSnapshotFromInput(input) {
  const candidate = extractRuntimeSnapshotCandidate(input);
  return candidate.ok ? candidate.snapshot : null;
}

export function parseRuntimeSnapshotMetafield(metafield) {
  if (!metafield) return null;

  if (isPlainObject(metafield.jsonValue)) {
    return metafield.jsonValue;
  }

  if (typeof metafield.value !== "string" || metafield.value.trim() === "") {
    return null;
  }

  return JSON.parse(metafield.value);
}

export function resolveDevRuntimeMode(options = {}) {
  const rawMode = options.runtimeMode || DEFAULT_DEV_RUNTIME_MODE;
  const mode = String(rawMode).trim();

  return DEV_RUNTIME_MODES.has(mode) ? mode : DEFAULT_DEV_RUNTIME_MODE;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
