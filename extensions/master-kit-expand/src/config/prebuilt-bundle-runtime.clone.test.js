import { describe, expect, it } from "vitest";

import { clonePrebuiltBundleRuntimeValue } from "./prebuilt-bundle-runtime.clone.js";

describe("pre-built Bundle runtime clone", () => {
  it("creates an independent copy of JSON-shaped Function data", () => {
    const source = {
      operations: [{ expand: { cartLineId: "gid://shopify/CartLine/1", quantities: [1, 2] } }],
    };

    const clone = clonePrebuiltBundleRuntimeValue(source);
    clone.operations[0].expand.quantities[0] = 9;

    expect(clone).not.toBe(source);
    expect(clone.operations[0]).not.toBe(source.operations[0]);
    expect(source.operations[0].expand.quantities).toEqual([1, 2]);
  });
});
