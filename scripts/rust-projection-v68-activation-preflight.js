import { createHash } from "node:crypto";

const APPROVED = Object.freeze({
  schemaVersion: "rust_projection_dev_approved_candidate.v1",
  versionTag: "cart-transform-poc-dev-68",
  versionId: "gid://shopify/Version/1062925795329",
  wasmSizeBytes: 113274,
  wasmSha256: "2ba39091bd4be734eb3faa0f739bf08c7cc29007cd2e21cf868187754e43b521",
});

export function fingerprintWasmArtifact(wasm) {
  if (!Buffer.isBuffer(wasm)) {
    throw new Error("The staged v68 Wasm artifact must be a Buffer.");
  }
  return {
    sizeBytes: wasm.length,
    sha256: createHash("sha256").update(wasm).digest("hex"),
  };
}

export function assertApprovedV68ActivationPreflight({
  approvedCandidate,
  versions,
  stagedWasmFingerprint,
}) {
  for (const [key, expected] of Object.entries(APPROVED)) {
    if (approvedCandidate?.[key] !== expected) {
      throw new Error(
        `The approved v68 candidate manifest has unexpected ${key}: `
        + `${JSON.stringify(approvedCandidate?.[key])}.`,
      );
    }
  }

  if (!Array.isArray(versions)) {
    throw new Error("The v68 activation preflight requires the current app versions.");
  }
  const candidates = versions.filter(({ versionTag }) => (
    versionTag === APPROVED.versionTag
  ));
  if (candidates.length !== 1 || candidates[0].status !== "inactive") {
    throw new Error(`The approved candidate ${APPROVED.versionTag} is not inactive.`);
  }
  const [candidate] = candidates;

  const observedVersionId = candidate.versionId ?? candidate.id;
  if (observedVersionId == null) {
    throw new Error(
      `The live inactive candidate ${APPROVED.versionTag} has no Version ID evidence.`,
    );
  }
  if (observedVersionId !== APPROVED.versionId) {
    throw new Error(
      `The inactive v68 Version ID is ${observedVersionId}; expected ${APPROVED.versionId}.`,
    );
  }

  if (
    stagedWasmFingerprint?.sizeBytes !== APPROVED.wasmSizeBytes
    || stagedWasmFingerprint?.sha256 !== APPROVED.wasmSha256
  ) {
    throw new Error(
      "The staged v68 Wasm does not match the approved "
      + `${APPROVED.wasmSizeBytes}/${APPROVED.wasmSha256} artifact.`,
    );
  }

  return {
    versionTag: APPROVED.versionTag,
    versionId: APPROVED.versionId,
    versionIdEvidence: "versions-list-and-approved-manifest",
    stagedWasm: {
      sizeBytes: APPROVED.wasmSizeBytes,
      sha256: APPROVED.wasmSha256,
    },
  };
}
