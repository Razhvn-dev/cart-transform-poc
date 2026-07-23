import { createHash } from "node:crypto";

const APPROVED = Object.freeze({
  schemaVersion: "rust_projection_dev_approved_candidate.v1",
  versionTag: "cart-transform-poc-dev-67",
  versionId: "gid://shopify/Version/1061480300545",
  wasmSizeBytes: 108602,
  wasmSha256: "16c43cd42cbaeaafe0c5d9b580c491678702527e144432b6039df97c19dc86c6",
});

export function fingerprintWasmArtifact(wasm) {
  if (!Buffer.isBuffer(wasm)) {
    throw new Error("The staged v67 Wasm artifact must be a Buffer.");
  }
  return {
    sizeBytes: wasm.length,
    sha256: createHash("sha256").update(wasm).digest("hex"),
  };
}

export function assertApprovedV67ActivationPreflight({
  approvedCandidate,
  versions,
  stagedWasmFingerprint,
}) {
  for (const [key, expected] of Object.entries(APPROVED)) {
    if (approvedCandidate?.[key] !== expected) {
      throw new Error(
        `The approved v67 candidate manifest has unexpected ${key}: `
        + `${JSON.stringify(approvedCandidate?.[key])}.`,
      );
    }
  }

  if (!Array.isArray(versions)) {
    throw new Error("The v67 activation preflight requires the current app versions.");
  }
  const candidate = versions.find(({ versionTag, status }) => (
    versionTag === APPROVED.versionTag && status === "inactive"
  ));
  if (!candidate) {
    throw new Error(`The approved candidate ${APPROVED.versionTag} is not inactive.`);
  }

  const observedVersionId = candidate.versionId ?? candidate.id;
  if (observedVersionId == null) {
    throw new Error(
      `The live inactive candidate ${APPROVED.versionTag} has no Version ID evidence.`,
    );
  }
  if (observedVersionId !== APPROVED.versionId) {
    throw new Error(
      `The inactive v67 Version ID is ${observedVersionId}; expected ${APPROVED.versionId}.`,
    );
  }

  if (
    stagedWasmFingerprint?.sizeBytes !== APPROVED.wasmSizeBytes
    || stagedWasmFingerprint?.sha256 !== APPROVED.wasmSha256
  ) {
    throw new Error(
      "The staged v67 Wasm does not match the approved "
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
