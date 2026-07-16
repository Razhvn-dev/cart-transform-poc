import { readFile as readFileFromDisk } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { assertPublicationPromotionEvidence } from "../../../extensions/master-kit-expand/src/config/bundle-publication.promotion-evidence.js";

const SAFE_IDENTIFIER = /^[0-9a-f-]+$/i;
const CHECKSUM = /^[0-9a-f]{8}$/i;

export class BundleAdminPromotionEvidenceError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "BundleAdminPromotionEvidenceError";
    this.code = code;
    this.details = details;
  }
}

// Server-only reader for artifacts produced by the offline parity generator.
// The requested target comes from persisted revision data, never the HTTP body.
export function createFilePublicationPromotionEvidenceProvider({
  evidenceDirectory,
  readFile = readFileFromDisk,
}) {
  const directory = resolveRequiredDirectory(evidenceDirectory);
  if (typeof readFile !== "function") throw new TypeError("readFile must be a function");

  return {
    async resolvePromotionEvidence({ definition, revision, snapshot_checksum: snapshotChecksum }) {
      const expected = {
        bundle_definition_id: definition?.bundle_definition_id,
        revision_id: revision?.revision_id,
        snapshot_checksum: snapshotChecksum,
      };
      const path = evidencePath(directory, expected);
      let source;
      try {
        source = await readFile(path, "utf8");
      } catch (error) {
        throw new BundleAdminPromotionEvidenceError(
          "NOT_FOUND",
          "publication promotion evidence was not found for the draft Snapshot",
          { source: "promotion_evidence", code: error?.code ?? null },
        );
      }

      let evidence;
      try {
        evidence = JSON.parse(source);
      } catch {
        throw new BundleAdminPromotionEvidenceError(
          "VALIDATION_FAILED",
          "publication promotion evidence contains invalid JSON",
          { source: "promotion_evidence" },
        );
      }

      try {
        assertPublicationPromotionEvidence(evidence, expected);
      } catch (error) {
        throw new BundleAdminPromotionEvidenceError(
          "VALIDATION_FAILED",
          "publication promotion evidence does not match the draft Snapshot",
          { source: "promotion_evidence", reason: error.message },
        );
      }
      return { evidence: structuredClone(evidence) };
    },
  };
}

export function publicationPromotionEvidenceFileName({
  bundle_definition_id: bundleDefinitionId,
  revision_id: revisionId,
  snapshot_checksum: snapshotChecksum,
}) {
  assertSafeIdentifier(bundleDefinitionId, "bundle_definition_id");
  assertSafeIdentifier(revisionId, "revision_id");
  if (typeof snapshotChecksum !== "string" || !CHECKSUM.test(snapshotChecksum)) {
    throw new BundleAdminPromotionEvidenceError("VALIDATION_FAILED", "snapshot_checksum is invalid");
  }
  return `${bundleDefinitionId}.${revisionId}.${snapshotChecksum}.json`;
}

function evidencePath(directory, expected) {
  const candidate = resolve(directory, publicationPromotionEvidenceFileName(expected));
  if (!candidate.startsWith(`${directory}${sep}`)) {
    throw new BundleAdminPromotionEvidenceError("VALIDATION_FAILED", "publication evidence path is invalid");
  }
  return candidate;
}

function resolveRequiredDirectory(directory) {
  if (typeof directory !== "string" || directory.trim() === "") {
    throw new BundleAdminPromotionEvidenceError("UNSUPPORTED_CAPABILITY", "publication evidence directory is required");
  }
  return resolve(directory);
}

function assertSafeIdentifier(value, field) {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
    throw new BundleAdminPromotionEvidenceError("VALIDATION_FAILED", `${field} is invalid`);
  }
}
