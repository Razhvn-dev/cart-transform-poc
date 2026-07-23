import { describe, expect, test } from "vitest";

import {
  classifyConservativeInstructionBudget,
  classifyInstructionBudget,
  compareFunctionOutputs,
  evaluateRustSpikeReleaseGate,
} from "./prebuilt-projection-rust-spike-result.js";

describe("Rust projection spike result gates", () => {
  test("accepts exact values regardless of object field order", () => {
    expect(() => compareFunctionOutputs(
      { operations: [{ expand: { title: "Bundle", items: [1, 2] } }] },
      { operations: [{ expand: { items: [1, 2], title: "Bundle" } }] },
      "synthetic-8",
    )).not.toThrow();
  });

  test("rejects component array order changes with the first differing path", () => {
    expect(() => compareFunctionOutputs(
      { operations: [{ expand: { items: ["a", "b"] } }] },
      { operations: [{ expand: { items: ["b", "a"] } }] },
      "synthetic-8",
    )).toThrow("synthetic-8 output differs at $.operations[0].expand.items[0]");
  });

  test("accepts numerically equal fixed-price Decimal scalar formatting", () => {
    const expected = {
      operations: [{ expand: { expandedCartItems: [{
        price: { adjustment: { fixedPricePerUnit: { amount: "10.00" } } },
      }] } }],
    };
    const actual = {
      operations: [{ expand: { expandedCartItems: [{
        price: { adjustment: { fixedPricePerUnit: { amount: "10.0" } } },
      }] } }],
    };

    expect(() => compareFunctionOutputs(expected, actual, "synthetic-8")).not.toThrow();
    expect(() => compareFunctionOutputs({ value: "10.00" }, { value: "10.0" }, "other"))
      .toThrow("other output differs at $.value");
  });

  test.each([
    [8_800_000, "pass", 2_200_000],
    [8_800_001, "risk-review", 2_199_999],
    [11_000_000, "risk-review", 0],
    [11_000_001, "fail", -1],
  ])("classifies %i instructions as %s", (instructions, status, headroom) => {
    expect(classifyInstructionBudget(instructions)).toEqual({
      status,
      instructions,
      headroom,
    });
  });

  test.each([
    [8_800_000, "pass", 2_200_000],
    [8_800_001, "fail", 2_199_999],
    [11_000_000, "fail", 0],
    [11_000_001, "fail", -1],
  ])("applies a hard 20 percent conservative headroom gate to %i instructions", (
    instructions,
    status,
    headroom,
  ) => {
    expect(classifyConservativeInstructionBudget(instructions)).toEqual({
      status,
      instructions,
      headroom,
      requiredHeadroom: 2_200_000,
      headroomRatio: headroom / 11_000_000,
    });
  });

  test("keeps expected unsupported boundary probes out of the default release gate", () => {
    const result = evaluateRustSpikeReleaseGate({
      supported: [{ fixture: "worst-string-19", rust: { status: "pass" } }],
      boundaryProbes: [
        { fixture: "real-cart-6x19", expectedBudgetStatus: "risk-review", rust: { status: "risk-review" } },
        { fixture: "real-cart-7x19", expectedBudgetStatus: "fail", rust: { status: "fail" } },
      ],
    });

    expect(result.releaseStatus).toBe("pass");
    expect(result.shouldFail).toBe(false);
    expect(result.boundaryProbes.map(({ boundaryStatus }) => boundaryStatus))
      .toEqual(["expected_boundary", "expected_boundary"]);
  });

  test("strict probe mode returns nonzero semantics for known unsupported probes", () => {
    const result = evaluateRustSpikeReleaseGate({
      supported: [{ fixture: "worst-string-19", rust: { status: "pass" } }],
      boundaryProbes: [{
        fixture: "worst-string-cart-2x19",
        expectedBudgetStatus: "risk-review",
        rust: { status: "risk-review" },
      }],
      strictProbes: true,
    });

    expect(result.releaseStatus).toBe("pass");
    expect(result.shouldFail).toBe(true);
    expect(result.strictProbeStatus).toBe("unsupported_boundary_detected");
  });

  test("never hides a supported envelope regression", () => {
    const result = evaluateRustSpikeReleaseGate({
      supported: [{ fixture: "worst-string-19", rust: { status: "risk-review" } }],
      boundaryProbes: [],
    });

    expect(result.releaseStatus).toBe("fail");
    expect(result.shouldFail).toBe(true);
  });
});
