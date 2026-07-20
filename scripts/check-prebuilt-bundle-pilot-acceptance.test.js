import { describe, expect, it } from "vitest";

import { parsePilotAcceptanceArguments } from "./check-prebuilt-bundle-pilot-acceptance.mjs";

describe("pre-built Bundle pilot acceptance CLI", () => {
  it("accepts exactly one evidence input", () => {
    expect(parsePilotAcceptanceArguments(["--input", "pilot-evidence.json"]))
      .toEqual({ inputPath: "pilot-evidence.json" });
    expect(() => parsePilotAcceptanceArguments([])).toThrow("usage");
    expect(() => parsePilotAcceptanceArguments(["--apply"])).toThrow("read-only");
  });
});
