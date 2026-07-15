import { describe, expect, it } from "vitest";
import {
  observeRuntimeSnapshotInput,
  parseRuntimeSnapshotMetafield,
} from "./bundle-runtime.extraction.js";

function inputWithMetafield(metafield) {
  return {
    cart: {
      lines: [
        {
          merchandise: {
            product: {
              runtimeSnapshotDevMetafield: metafield,
            },
          },
        },
      ],
    },
  };
}

describe("Stage 4 Runtime Snapshot extraction", () => {
  it("returns a valid jsonValue object", () => {
    const snapshot = { snapshot_schema: "bundle_runtime.v1" };

    expect(parseRuntimeSnapshotMetafield({ jsonValue: snapshot })).toBe(snapshot);
  });

  it("returns a valid object parsed from string value", () => {
    const snapshot = { snapshot_schema: "bundle_runtime.v1" };

    expect(parseRuntimeSnapshotMetafield({ value: JSON.stringify(snapshot) }))
      .toEqual(snapshot);
  });

  it("returns null for a missing metafield", () => {
    expect(observeRuntimeSnapshotInput(inputWithMetafield(null))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseRuntimeSnapshotMetafield({ value: "{not-json" })).toBeNull();
  });

  it("returns null for null or scalar metafield values", () => {
    expect(parseRuntimeSnapshotMetafield({ jsonValue: null, value: null })).toBeNull();
    expect(parseRuntimeSnapshotMetafield({ jsonValue: 7, value: "7" })).toBeNull();
    expect(parseRuntimeSnapshotMetafield({ jsonValue: "snapshot", value: "\"snapshot\"" }))
      .toBeNull();
  });
});
