import { describe, expect, it } from "vitest";
import {
  BundleAdminPromotionEvidenceError,
  createFilePublicationPromotionEvidenceProvider,
  publicationPromotionEvidenceFileName,
} from "./bundle-admin.promotion-evidence.server.js";

const expected = {
  bundle_definition_id: "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89",
  revision_id: "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702",
  snapshot_checksum: "8b6be811",
};

function evidence(overrides = {}) {
  return {
    schema_version: "bundle_publication_promotion_evidence.v1",
    ...expected,
    fixture_set_id: "unit-test",
    fixtures: [{
      fixture_id: "standard-build",
      hardcoded_result: { operations: [] },
      candidate_result: { operations: [] },
    }],
    ...overrides,
  };
}

function request() {
  return {
    definition: { bundle_definition_id: expected.bundle_definition_id },
    revision: { revision_id: expected.revision_id },
    snapshot_checksum: expected.snapshot_checksum,
  };
}

describe("Bundle Admin promotion evidence provider", () => {
  it("reads only the deterministic checksum-bound evidence artifact", async () => {
    const calls = [];
    const provider = createFilePublicationPromotionEvidenceProvider({
      evidenceDirectory: "/var/lib/bundle-publication-evidence",
      readFile: async (path) => {
        calls.push(path);
        return JSON.stringify(evidence());
      },
    });

    await expect(provider.resolvePromotionEvidence(request())).resolves.toEqual({ evidence: evidence() });
    expect(calls[0]).toMatch(/f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89\.1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702\.8b6be811\.json$/);
  });

  it("rejects missing, malformed, and target-mismatched evidence", async () => {
    const missing = createFilePublicationPromotionEvidenceProvider({
      evidenceDirectory: "/var/lib/bundle-publication-evidence",
      readFile: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
    });
    const malformed = createFilePublicationPromotionEvidenceProvider({
      evidenceDirectory: "/var/lib/bundle-publication-evidence",
      readFile: async () => "{not-json",
    });
    const mismatch = createFilePublicationPromotionEvidenceProvider({
      evidenceDirectory: "/var/lib/bundle-publication-evidence",
      readFile: async () => JSON.stringify(evidence({ revision_id: "other" })),
    });

    await expect(missing.resolvePromotionEvidence(request())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(malformed.resolvePromotionEvidence(request())).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(mismatch.resolvePromotionEvidence(request())).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects unsafe file-name inputs before attempting a read", () => {
    expect(() => publicationPromotionEvidenceFileName({ ...expected, revision_id: "../outside" }))
      .toThrow(BundleAdminPromotionEvidenceError);
  });
});
