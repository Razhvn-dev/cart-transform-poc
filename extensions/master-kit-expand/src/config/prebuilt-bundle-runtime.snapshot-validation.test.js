import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { attachRuntimeSnapshotChecksum } from "./bundle-runtime.checksum.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { validatePrebuiltRuntimeSnapshotForFunction } from "./prebuilt-bundle-runtime.snapshot-validation.js";

describe("pre-built hosted Snapshot validation", () => {
  it("accepts a compiler-produced checksum-valid Snapshot", () => {
    expect(validatePrebuiltRuntimeSnapshotForFunction(
      compileRuntimeSnapshot(masterKitConfigV1),
    )).toEqual([]);
  });

  it("rejects tampered content even when the stored checksum is unchanged", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const tampered = {
      ...snapshot,
      groups: snapshot.groups.map((group, index) => index === 0
        ? {
            ...group,
            options: group.options.map((option, optionIndex) => optionIndex === 0
              ? { ...option, price_cents: option.price_cents + 1 }
              : option),
          }
        : group),
    };

    expect(validatePrebuiltRuntimeSnapshotForFunction(tampered)).toEqual(["CHECKSUM_INVALID"]);
  });

  it("rejects malformed parent, group, rule, pricing, and metadata boundaries", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const cases = [
      [attachRuntimeSnapshotChecksum({ ...snapshot, parent: null }), "PARENT_INVALID"],
      [attachRuntimeSnapshotChecksum({ ...snapshot, groups: [] }), "GROUPS_INVALID"],
      [attachRuntimeSnapshotChecksum({ ...snapshot, rules: null }), "RULES_INVALID"],
      [attachRuntimeSnapshotChecksum({ ...snapshot, pricing: null }), "PRICING_INVALID"],
      [attachRuntimeSnapshotChecksum({ ...snapshot, metadata: null }), "METADATA_INVALID"],
    ];

    cases.forEach(([candidate, expected]) => {
      expect(validatePrebuiltRuntimeSnapshotForFunction(candidate)[0]).toBe(expected);
    });
  });
});
