import { describe, expect, it, vi } from "vitest";

import { executeDevPublicationCasProbe } from "./dev-shopify-publication-rehearsal.cas-probe.js";

const probe = Object.freeze({
  key: "bundle_runtime_snapshot_publication_rehearsal_cas_probe_11111111",
  ownerNonce: "11111111-1111-4111-8111-111111111111",
});

describe("development publication rehearsal staged CAS probe", () => {
  it("creates only the invocation-owned probe after reconciling absence", async () => {
    const set = vi.fn(async () => ({
      metafields: [{ compareDigest: "digest-1" }],
      userErrors: [],
    }));
    const result = await executeDevPublicationCasProbe({
      probe,
      read: vi.fn(async () => null),
      set,
      remove: vi.fn(),
    });

    expect(result).toMatchObject({ status: "created", next_step: "update" });
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      key: probe.key,
      value: { probe_version: 1, owner_nonce: probe.ownerNonce },
      compareDigest: null,
    });
  });

  it("stops without cleanup after an ambiguous create outcome", async () => {
    const remove = vi.fn();
    await expect(executeDevPublicationCasProbe({
      probe,
      read: vi.fn(async () => null),
      set: vi.fn(async () => { throw new Error("socket hang up"); }),
      remove,
    })).rejects.toThrow("socket hang up");
    expect(remove).not.toHaveBeenCalled();
  });

  it("updates one reconciled owned probe and persists the stale digest evidence", async () => {
    const set = vi.fn(async () => ({
      metafields: [{ compareDigest: "digest-2" }],
      userErrors: [],
    }));
    const result = await executeDevPublicationCasProbe({
      probe,
      read: vi.fn(async () => ({
        value: JSON.stringify({ probe_version: 1, owner_nonce: probe.ownerNonce }),
        compareDigest: "digest-1",
      })),
      set,
      remove: vi.fn(),
    });

    expect(result).toMatchObject({ status: "updated", next_step: "stale_probe" });
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      key: probe.key,
      value: {
        probe_version: 2,
        owner_nonce: probe.ownerNonce,
        stale_compare_digest: "digest-1",
      },
      compareDigest: "digest-1",
    });
  });

  it("stops without cleanup after ambiguous update or stale outcomes", async () => {
    const remove = vi.fn();
    for (const current of [
      {
        value: JSON.stringify({ probe_version: 1, owner_nonce: probe.ownerNonce }),
        compareDigest: "digest-1",
      },
      {
        value: JSON.stringify({
          probe_version: 2,
          owner_nonce: probe.ownerNonce,
          stale_compare_digest: "digest-1",
        }),
        compareDigest: "digest-2",
      },
    ]) {
      await expect(executeDevPublicationCasProbe({
        probe,
        read: vi.fn(async () => current),
        set: vi.fn(async () => { throw new Error("socket hang up"); }),
        remove,
      })).rejects.toThrow("socket hang up");
    }
    expect(remove).not.toHaveBeenCalled();
  });

  it("returns exact cleanup evidence only after a known stale rejection", async () => {
    const current = {
      value: JSON.stringify({
        probe_version: 2,
        owner_nonce: probe.ownerNonce,
        stale_compare_digest: "digest-1",
      }),
      compareDigest: "digest-2",
    };
    const result = await executeDevPublicationCasProbe({
      probe,
      read: vi.fn(async () => current),
      set: vi.fn(async () => ({
        metafields: [],
        userErrors: [{ code: "INVALID_COMPARE_DIGEST", message: "stale" }],
      })),
      remove: vi.fn(),
    });

    expect(result).toEqual({
      status: "stale_rejected",
      stale_cas_error: "INVALID_COMPARE_DIGEST",
      next_step: "cleanup",
      cleanup_evidence: {
        key: probe.key,
        owner_nonce: probe.ownerNonce,
        value: current.value,
        compare_digest: "digest-2",
      },
    });
  });

  it("cleans up only when exact value, nonce, and digest evidence still match", async () => {
    const current = {
      value: JSON.stringify({
        probe_version: 2,
        owner_nonce: probe.ownerNonce,
        stale_compare_digest: "digest-1",
      }),
      compareDigest: "digest-2",
    };
    const cleanupEvidence = {
      key: probe.key,
      owner_nonce: probe.ownerNonce,
      value: current.value,
      compare_digest: current.compareDigest,
    };
    const remove = vi.fn(async () => ({ deletedMetafields: [{ key: probe.key }], userErrors: [] }));

    await expect(executeDevPublicationCasProbe({
      probe: { ...probe, cleanupEvidence },
      read: vi.fn(async () => current),
      set: vi.fn(),
      remove,
    })).resolves.toEqual({ status: "cleaned_up", next_step: null });
    expect(remove).toHaveBeenCalledWith(cleanupEvidence);
  });

  it("fails closed on foreign ownership or concurrent cleanup drift", async () => {
    const set = vi.fn();
    const remove = vi.fn();
    await expect(executeDevPublicationCasProbe({
      probe,
      read: vi.fn(async () => ({
        value: JSON.stringify({ probe_version: 1, owner_nonce: "foreign" }),
        compareDigest: "foreign-digest",
      })),
      set,
      remove,
    })).rejects.toThrow(/owner nonce/i);

    const expectedValue = JSON.stringify({
      probe_version: 2,
      owner_nonce: probe.ownerNonce,
      stale_compare_digest: "digest-1",
    });
    await expect(executeDevPublicationCasProbe({
      probe: {
        ...probe,
        cleanupEvidence: {
          key: probe.key,
          owner_nonce: probe.ownerNonce,
          value: expectedValue,
          compare_digest: "digest-2",
        },
      },
      read: vi.fn(async () => ({ value: expectedValue, compareDigest: "drifted-digest" })),
      set,
      remove,
    })).rejects.toThrow(/cleanup evidence/i);

    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
