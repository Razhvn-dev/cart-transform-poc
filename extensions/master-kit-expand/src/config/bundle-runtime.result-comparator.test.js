import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { comparePreparedFunctionResults } from "./bundle-runtime.result-comparator.js";

function result(overrides = {}) {
  return {
    operations: [{
      expand: {
        cartLineId: "gid://shopify/CartLine/1",
        title: "Master Kit Test",
        expandedCartItems: [{
          merchandiseId: "gid://shopify/ProductVariant/1",
          quantity: 1,
          price: { adjustment: { fixedPricePerUnit: { amount: "1.00" } } },
        }],
        ...overrides,
      },
    }],
  };
}

describe("runtime result comparator", () => {
  it("has no fixture, compiler, validator, or resolver runtime dependency", () => {
    const source = readFileSync(
      new URL("./bundle-runtime.result-comparator.js", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/^(?:import|export).*masterKitConfigV1/m);
    expect(source).not.toMatch(/^(?:import|export).*compileRuntimeSnapshot/m);
    expect(source).not.toMatch(/^(?:import|export).*bundle-runtime\.(?:compiler|validator|resolver)/m);
    expect(source).not.toContain("DEFAULT_RUNTIME_SNAPSHOT");
  });

  it("detects value mismatches without mutating either supplied result", () => {
    const hardcoded = result();
    const candidate = result({
      expandedCartItems: [{
        merchandiseId: "gid://shopify/ProductVariant/2",
        quantity: 1,
        price: { adjustment: { fixedPricePerUnit: { amount: "2.00" } } },
      }],
    });
    const hardcodedBefore = JSON.stringify(hardcoded);
    const candidateBefore = JSON.stringify(candidate);

    const comparison = comparePreparedFunctionResults(hardcoded, candidate);

    expect(comparison.match).toBe(false);
    expect(comparison.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "operations[0].expand.expandedCartItems[0].merchandiseId",
      }),
      expect.objectContaining({
        path: "operations[0].expand.expandedCartItems[0].amount",
      }),
    ]));
    expect(JSON.stringify(hardcoded)).toBe(hardcodedBefore);
    expect(JSON.stringify(candidate)).toBe(candidateBefore);
  });

  it("detects unknown fields on either supplied operation shape", () => {
    const hardcoded = result({ unexpectedHardcodedField: true });
    const candidate = result({ unexpectedCandidateField: true });

    const comparison = comparePreparedFunctionResults(hardcoded, candidate);

    expect(comparison.match).toBe(false);
    expect(comparison.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "operations[0].expand.unexpectedHardcodedField",
        unsupported: true,
      }),
      expect.objectContaining({
        path: "operations[0].expand.unexpectedCandidateField",
        unsupported: true,
      }),
    ]));
  });
});
