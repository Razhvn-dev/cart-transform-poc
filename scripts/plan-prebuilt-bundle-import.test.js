import { describe, expect, it } from "vitest";
import { parsePrebuiltImportPlanArguments } from "./plan-prebuilt-bundle-import.mjs";

describe("pre-built Bundle import planner CLI", () => {
  it("accepts only an input package and optional known parent Variant list", () => {
    expect(parsePrebuiltImportPlanArguments(["--input", "import.json", "--existing-parent-variants", "[\"gid://shopify/ProductVariant/1\"]"]))
      .toEqual({ inputPath: "import.json", existingParentVariantGids: ["gid://shopify/ProductVariant/1"] });
  });

  it("has no apply mode and fails closed on incomplete input", () => {
    expect(() => parsePrebuiltImportPlanArguments(["--apply"])).toThrow("no apply mode");
    expect(() => parsePrebuiltImportPlanArguments([])).toThrow("usage");
    expect(() => parsePrebuiltImportPlanArguments(["--input", "import.json", "--unknown", "x"])).toThrow("unsupported");
  });
});
