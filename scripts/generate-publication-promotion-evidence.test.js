import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { assertPublicationPromotionEvidence } from "../extensions/master-kit-expand/src/config/bundle-publication.promotion-evidence.js";
import { masterKitConfigV1 } from "../extensions/master-kit-expand/src/config/fixtures/master-kit-config.v1.js";
import {
  PublicationPromotionEvidenceBuildError,
  enumerateFixtureSelections,
  generatePublicationPromotionEvidence,
} from "./generate-publication-promotion-evidence.mjs";

const definitionId = "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89";
const revisionId = "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702";

describe("offline publication promotion evidence generation", () => {
  it("proves exact parity for every supported option combination", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
    const evidence = generatePublicationPromotionEvidence({
      bundleDefinitionId: definitionId,
      revisionId,
      snapshot,
    });

    expect(evidence.fixtures).toHaveLength(16);
    expect(() => assertPublicationPromotionEvidence(evidence, {
      bundle_definition_id: definitionId,
      revision_id: revisionId,
      snapshot_checksum: snapshot.checksum,
    })).not.toThrow();
  });

  it("fails closed when a Snapshot cannot match the hard-coded Shared Core", () => {
    const configuration = structuredClone(masterKitConfigV1);
    configuration.parent.variant_gid = "gid://shopify/ProductVariant/999999";
    const snapshot = compileRuntimeSnapshot(configuration);

    expect(() => generatePublicationPromotionEvidence({
      bundleDefinitionId: definitionId,
      revisionId,
      snapshot,
    })).toThrow(PublicationPromotionEvidenceBuildError);
  });

  it("rejects configurations whose complete option space exceeds the approved fixture limit", () => {
    const snapshot = compileRuntimeSnapshot(masterKitConfigV1);

    expect(() => enumerateFixtureSelections(snapshot, 8)).toThrow(/exceed the approved limit/);
  });

  it("fails visibly when the CLI input file is unavailable", () => {
    const result = spawnSync(process.execPath, [
      "scripts/generate-publication-promotion-evidence.mjs",
      "--snapshot", ".missing-snapshot.json",
      "--bundle-definition-id", definitionId,
      "--revision-id", revisionId,
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ENOENT");
  });
});
