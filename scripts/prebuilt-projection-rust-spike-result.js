export function compareFunctionOutputs(expected, actual, fixtureLabel = "fixture") {
  const difference = firstDifference(expected, actual, "$");
  if (difference == null) return;
  throw new Error(
    `${fixtureLabel} output differs at ${difference.path}: expected ${formatValue(difference.expected)}, actual ${formatValue(difference.actual)}`,
  );
}

export function classifyInstructionBudget(
  instructions,
  limit = 11_000_000,
  target = 8_800_000,
) {
  if (!Number.isSafeInteger(instructions) || instructions < 0) {
    throw new Error(`Invalid instruction count: ${instructions}`);
  }
  return {
    status: instructions > limit
      ? "fail"
      : instructions > target
        ? "risk-review"
        : "pass",
    instructions,
    headroom: limit - instructions,
  };
}

export function classifyConservativeInstructionBudget(
  instructions,
  limit = 11_000_000,
  minimumHeadroomRatio = 0.2,
) {
  if (!Number.isFinite(minimumHeadroomRatio)
    || minimumHeadroomRatio < 0
    || minimumHeadroomRatio > 1) {
    throw new Error(`Invalid minimum headroom ratio: ${minimumHeadroomRatio}`);
  }
  const { headroom } = classifyInstructionBudget(instructions, limit, limit);
  const requiredHeadroom = Math.ceil(limit * minimumHeadroomRatio);
  return {
    status: headroom >= requiredHeadroom ? "pass" : "fail",
    instructions,
    headroom,
    requiredHeadroom,
    headroomRatio: headroom / limit,
  };
}

export function evaluateRustSpikeReleaseGate({
  supported = [],
  boundaryProbes = [],
  strictProbes = false,
} = {}) {
  const evaluatedBoundaryProbes = boundaryProbes.map((probe) => ({
    ...probe,
    boundaryStatus: probe.rust?.status === probe.expectedBudgetStatus
      ? "expected_boundary"
      : "unexpected_boundary",
  }));
  const releaseStatus = supported.every(({ rust }) => rust?.status === "pass")
    ? "pass"
    : "fail";
  const strictProbeFailure = evaluatedBoundaryProbes.some((probe) => (
    probe.rust?.status !== "pass" || probe.boundaryStatus !== "expected_boundary"
  ));
  return {
    releaseStatus,
    strictProbeStatus: strictProbes
      ? strictProbeFailure
        ? "unsupported_boundary_detected"
        : "pass"
      : "not_requested",
    shouldFail: releaseStatus !== "pass" || (strictProbes && strictProbeFailure),
    supported,
    boundaryProbes: evaluatedBoundaryProbes,
  };
}

function firstDifference(expected, actual, path) {
  if (Object.is(expected, actual)) return null;
  if (isFixedPriceDecimalPath(path)
    && canonicalDecimal(expected) != null
    && canonicalDecimal(expected) === canonicalDecimal(actual)) {
    return null;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return { path, expected, actual };
    }
    if (expected.length !== actual.length) {
      return { path: `${path}.length`, expected: expected.length, actual: actual.length };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference != null) return difference;
    }
    return null;
  }
  if (isObject(expected) && isObject(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) {
        return { path: `${path}.${key}`, expected: expected[key], actual: actual[key] };
      }
      const difference = firstDifference(expected[key], actual[key], `${path}.${key}`);
      if (difference != null) return difference;
    }
    return null;
  }
  return { path, expected, actual };
}

function isFixedPriceDecimalPath(path) {
  return path.endsWith(".price.adjustment.fixedPricePerUnit.amount");
}

function canonicalDecimal(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [wholePart, fractionPart = ""] = value.split(".");
  const whole = wholePart.replace(/^0+(?=\d)/, "");
  const fraction = fractionPart.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function formatValue(value) {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}
