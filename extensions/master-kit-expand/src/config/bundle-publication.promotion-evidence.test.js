import { describe, expect, it } from "vitest";
import {
  BUNDLE_PUBLICATION_PROMOTION_EVIDENCE_SCHEMA,
  assertPublicationPromotionEvidence,
} from "./bundle-publication.promotion-evidence.js";

const expected = {
  bundle_definition_id: "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89",
  revision_id: "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702",
  snapshot_checksum: "1234abcd",
};

function evidence(overrides = {}) {
  return {
    schema_version: BUNDLE_PUBLICATION_PROMOTION_EVIDENCE_SCHEMA,
    bundle_definition_id: expected.bundle_definition_id,
    revision_id: expected.revision_id,
    snapshot_checksum: expected.snapshot_checksum,
    fixture_set_id: "master-kit-runtime-v1",
    fixtures: [{
      fixture_id: "standard-build",
      hardcoded_result: { operations: [] },
      candidate_result: { operations: [] },
    }],
    ...overrides,
  };
}

describe("bundle publication promotion evidence", () => {
  it("accepts exact parity evidence bound to the publication target", () => {
    expect(assertPublicationPromotionEvidence(evidence(), expected)).toMatchObject({
      fixture_set_id: "master-kit-runtime-v1",
      fixture_count: 1,
      comparisons: [{ fixture_id: "standard-build", comparison: { match: true, differences: [] } }],
    });
  });

  it.each([
    ["wrong definition", evidence({ bundle_definition_id: "other" })],
    ["wrong revision", evidence({ revision_id: "other" })],
    ["wrong checksum", evidence({ snapshot_checksum: "deadbeef" })],
    ["unsupported schema", evidence({ schema_version: "bundle_publication_promotion_evidence.v2" })],
    ["empty fixture set", evidence({ fixtures: [] })],
    ["duplicate fixture", evidence({ fixtures: [
      { fixture_id: "same", hardcoded_result: { operations: [] }, candidate_result: { operations: [] } },
      { fixture_id: "same", hardcoded_result: { operations: [] }, candidate_result: { operations: [] } },
    ] })],
    ["mismatch", evidence({ fixtures: [{
      fixture_id: "standard-build",
      hardcoded_result: { operations: [] },
      candidate_result: { operations: [{ expand: {} }] },
    }] })],
  ])("rejects %s", (_name, value) => {
    expect(() => assertPublicationPromotionEvidence(value, expected)).toThrow();
  });
});
