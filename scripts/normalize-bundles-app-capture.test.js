import { describe, expect, it } from "vitest";

import { parseBundlesAppCaptureArguments } from "./normalize-bundles-app-capture.mjs";

describe("Bundles.app capture CLI", () => {
  it("accepts only the two read-only source inputs", () => {
    expect(parseBundlesAppCaptureArguments([
      "--variants-csv", "variants.csv",
      "--capture", "bundle.json",
      "--products-csv", "products.csv",
    ])).toEqual({ variantsCsvPath: "variants.csv", productsCsvPath: "products.csv", capturePath: "bundle.json" });
    expect(() => parseBundlesAppCaptureArguments(["--apply"])).toThrow("read-only");
    expect(() => parseBundlesAppCaptureArguments(["--output", "result.json"])).toThrow("read-only");
    expect(() => parseBundlesAppCaptureArguments(["--variants-csv", "variants.csv"])).toThrow("usage");
  });
});
