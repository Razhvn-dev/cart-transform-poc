import { findStaleCasConflict } from "./dev-shopify-publication-rehearsal.execution.js";

export async function executeDevPublicationCasProbe({ probe, set, read, remove } = {}) {
  assertDependencies({ probe, set, read, remove });
  const current = await read({ key: probe.key });

  if (probe.cleanupEvidence) {
    assertCleanupEvidence({ current, probe });
    const cleanup = await remove(probe.cleanupEvidence);
    assertNoUserErrors(cleanup, "cleanup");
    return Object.freeze({ status: "cleaned_up", next_step: null });
  }

  if (current === null) {
    const created = await set({
      key: probe.key,
      value: { probe_version: 1, owner_nonce: probe.ownerNonce },
      compareDigest: null,
    });
    assertNoUserErrors(created, "create");
    const compareDigest = created.metafields?.[0]?.compareDigest;
    if (!compareDigest) throw new Error("CAS probe create returned no compareDigest");
    return Object.freeze({
      status: "created",
      next_step: "update",
      compare_digest: compareDigest,
    });
  }

  const document = parseOwnedDocument(current, probe.ownerNonce);
  if (!current.compareDigest) throw new Error("CAS probe reconciliation returned no compareDigest");

  if (document.probe_version === 1) {
    const updated = await set({
      key: probe.key,
      value: {
        probe_version: 2,
        owner_nonce: probe.ownerNonce,
        stale_compare_digest: current.compareDigest,
      },
      compareDigest: current.compareDigest,
    });
    assertNoUserErrors(updated, "update");
    const compareDigest = updated.metafields?.[0]?.compareDigest;
    if (!compareDigest || compareDigest === current.compareDigest) {
      throw new Error("CAS probe update did not rotate compareDigest");
    }
    return Object.freeze({
      status: "updated",
      next_step: "stale_probe",
      compare_digest: compareDigest,
    });
  }

  if (document.probe_version === 2) {
    if (typeof document.stale_compare_digest !== "string" || document.stale_compare_digest === "") {
      throw new Error("CAS probe stale compareDigest evidence is missing");
    }
    const stale = await set({
      key: probe.key,
      value: { probe_version: 3, owner_nonce: probe.ownerNonce },
      compareDigest: document.stale_compare_digest,
    });
    const staleError = findStaleCasConflict(stale?.userErrors);
    if (!staleError) throw new Error("stale CAS was not rejected");
    return Object.freeze({
      status: "stale_rejected",
      stale_cas_error: staleError.code,
      next_step: "cleanup",
      cleanup_evidence: Object.freeze({
        key: probe.key,
        owner_nonce: probe.ownerNonce,
        value: current.value,
        compare_digest: current.compareDigest,
      }),
    });
  }

  throw new Error("CAS probe reconciliation found an unsupported probe version");
}

function assertDependencies({ probe, set, read, remove }) {
  if (typeof set !== "function" || typeof read !== "function" || typeof remove !== "function") {
    throw new Error("CAS probe requires set, read, and remove dependencies");
  }
  if (typeof probe?.key !== "string" || !/^bundle_runtime_snapshot_publication_rehearsal_cas_probe_[a-z0-9-]+$/i.test(probe.key)) {
    throw new Error("CAS probe requires an invocation-unique isolated key");
  }
  if (typeof probe.ownerNonce !== "string" || probe.ownerNonce.length < 16) {
    throw new Error("CAS probe requires an invocation-unique owner nonce");
  }
}

function parseOwnedDocument(current, ownerNonce) {
  let document;
  try {
    document = typeof current?.value === "string" ? JSON.parse(current.value) : current?.value;
  } catch {
    throw new Error("CAS probe reconciliation returned invalid JSON");
  }
  if (!document || document.owner_nonce !== ownerNonce) {
    throw new Error("CAS probe owner nonce does not match this invocation");
  }
  return document;
}

function assertCleanupEvidence({ current, probe }) {
  const evidence = probe.cleanupEvidence;
  if (evidence.key !== probe.key || evidence.owner_nonce !== probe.ownerNonce) {
    throw new Error("CAS probe cleanup evidence identity does not match");
  }
  const document = parseOwnedDocument(current, probe.ownerNonce);
  if (document.probe_version !== 2
      || current?.value !== evidence.value
      || current?.compareDigest !== evidence.compare_digest) {
    throw new Error("CAS probe cleanup evidence no longer matches the persisted probe");
  }
}

function assertNoUserErrors(result, step) {
  if (result?.userErrors?.length) {
    throw new Error(`CAS probe ${step} failed: ${result.userErrors.map((error) => error.message).join("; ")}`);
  }
}
