import { describe, expect, it } from "vitest";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { observeRuntimeSnapshotValidation } from "./bundle-runtime.validation-observation.js";

function inputWithSnapshot(snapshot) {
  return {
    cart: {
      lines: [{
        merchandise: {
          product: {
            runtimeSnapshotDevMetafield: { jsonValue: snapshot },
          },
        },
      }],
    },
  };
}

describe("Stage 5 Runtime Snapshot validation observation", () => {
  it("accepts a valid Snapshot", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);

    expect(observeRuntimeSnapshotValidation(inputWithSnapshot(snapshot))).toEqual([]);
  });

  it("reports an unsupported schema", () => {
    const snapshot = structuredClone(compileRuntimeSnapshot(masterKitConfigV1));
    snapshot.snapshot_schema = "bundle_runtime.v2";

    expect(observeRuntimeSnapshotValidation(inputWithSnapshot(snapshot)))
      .toContain('snapshot_schema must be "bundle_runtime.v1"');
  });

  it("reports a checksum mismatch", () => {
    const snapshot = structuredClone(compileRuntimeSnapshot(masterKitConfigV1));
    snapshot.groups[0].options[0].price_cents += 1;

    expect(observeRuntimeSnapshotValidation(inputWithSnapshot(snapshot)))
      .toContain("checksum does not match snapshot content");
  });

  it("reports validation errors for a malformed parsed object", () => {
    expect(observeRuntimeSnapshotValidation(inputWithSnapshot({ snapshot_schema: "bundle_runtime.v1" })))
      .toEqual(expect.arrayContaining([
        "configuration_id has invalid format",
        "parent must be an object",
      ]));
  });

  it("contains validation exceptions", () => {
    const snapshot = structuredClone(compileRuntimeSnapshot(masterKitConfigV1));
    Object.defineProperty(snapshot, "snapshot_schema", {
      get() {
        throw new Error("validation observer test exception");
      },
    });

    expect(observeRuntimeSnapshotValidation(inputWithSnapshot(snapshot))).toBeNull();
  });
});
