import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import {
  assertApprovedV68ActivationPreflight,
} from "./rust-projection-v68-activation-preflight.js";

const root = resolve(import.meta.dirname, "..");
const approved = Object.freeze({
  schemaVersion: "rust_projection_dev_approved_candidate.v1",
  versionTag: "cart-transform-poc-dev-68",
  versionId: "gid://shopify/Version/1062925795329",
  wasmSizeBytes: 113274,
  wasmSha256: "2ba39091bd4be734eb3faa0f739bf08c7cc29007cd2e21cf868187754e43b521",
});

describe("Rust projection release safety", () => {
  test("keeps Cargo.lock trackable and uses locked Cargo resolution", () => {
    const crateRoot = resolve(root, "extensions/master-kit-expand-rust-spike");
    const crateIgnore = readFileSync(resolve(crateRoot, ".gitignore"), "utf8");
    const buildRunner = readFileSync(
      resolve(root, "scripts/build-rust-projection-function.mjs"),
      "utf8",
    );
    const deployRunner = readFileSync(
      resolve(root, "scripts/deploy-dev-rust-projection.mjs"),
      "utf8",
    );
    const extensionManifest = readFileSync(
      resolve(crateRoot, "shopify.extension.toml"),
      "utf8",
    );

    expect(existsSync(resolve(crateRoot, "Cargo.lock"))).toBe(true);
    expect(crateIgnore).not.toMatch(/(?:^|\r?\n)\/?Cargo\.lock(?:\r?\n|$)/);
    expect(buildRunner).toMatch(/"build",[\s\S]*?"--locked"/);
    expect(deployRunner).toMatch(/"test",[\s\S]*?"--locked"/);
    expect(extensionManifest).toMatch(
      /command = "cargo build .*--locked.*--release"/,
    );
  });

  test("binds Shopify-transformed Wasm to one fresh Rust build invocation", () => {
    const buildRunner = readFileSync(
      resolve(root, "scripts/build-rust-projection-function.mjs"),
      "utf8",
    );
    const deployRunner = readFileSync(
      resolve(root, "scripts/deploy-dev-rust-projection.mjs"),
      "utf8",
    );

    expect(buildRunner).toContain("rust_projection_build_provenance.v1");
    expect(buildRunner).toContain("ACES_RUST_BUILD_INVOCATION_ID");
    expect(deployRunner).toContain("randomUUID");
    expect(deployRunner).toContain("expectedInvocationId");
    expect(deployRunner).toContain("buildProvenance");
  });

  test("binds v68 activation to the approved Version ID and Wasm fingerprint", () => {
    const deployRunner = readFileSync(
      resolve(root, "scripts/deploy-dev-rust-projection.mjs"),
      "utf8",
    );
    const approvedCandidate = JSON.parse(readFileSync(
      resolve(root, "scripts/rust-projection-v68-approved-candidate.json"),
      "utf8",
    ));
    const stagedWasmFingerprint = {
      sizeBytes: approved.wasmSizeBytes,
      sha256: approved.wasmSha256,
    };

    expect(deployRunner).toContain("assertApprovedV68ActivationPreflight");
    expect(approvedCandidate).toEqual(approved);
    expect(assertApprovedV68ActivationPreflight({
      approvedCandidate,
      versions: [{
        versionTag: approved.versionTag,
        status: "inactive",
        versionId: approved.versionId,
      }],
      stagedWasmFingerprint,
    })).toEqual(expect.objectContaining({
      versionTag: approved.versionTag,
      versionId: approved.versionId,
      versionIdEvidence: "versions-list-and-approved-manifest",
    }));
  });

  test("fails closed on a different v68 Version ID or Wasm fingerprint", () => {
    const base = {
      approvedCandidate: approved,
      versions: [{
        versionTag: approved.versionTag,
        status: "inactive",
        id: approved.versionId,
      }],
      stagedWasmFingerprint: {
        sizeBytes: approved.wasmSizeBytes,
        sha256: approved.wasmSha256,
      },
    };

    expect(() => assertApprovedV68ActivationPreflight({
      ...base,
      versions: [{
        versionTag: approved.versionTag,
        status: "inactive",
        id: "gid://shopify/Version/999",
      }],
    })).toThrow(/Version ID/i);
    expect(() => assertApprovedV68ActivationPreflight({
      ...base,
      stagedWasmFingerprint: {
        sizeBytes: approved.wasmSizeBytes - 1,
        sha256: approved.wasmSha256,
      },
    })).toThrow(/Wasm/i);
  });

  test("fails closed when versions list omits the live candidate GID", () => {
    expect(() => assertApprovedV68ActivationPreflight({
      approvedCandidate: approved,
      versions: [{
        versionTag: approved.versionTag,
        status: "inactive",
      }],
      stagedWasmFingerprint: {
        sizeBytes: approved.wasmSizeBytes,
        sha256: approved.wasmSha256,
      },
    })).toThrow(/live.*Version ID/i);

    expect(() => assertApprovedV68ActivationPreflight({
      approvedCandidate: { ...approved, versionId: "gid://shopify/Version/999" },
      versions: [{
        versionTag: approved.versionTag,
        status: "inactive",
      }],
      stagedWasmFingerprint: {
        sizeBytes: approved.wasmSizeBytes,
        sha256: approved.wasmSha256,
      },
    })).toThrow(/manifest.*versionId/i);
  });

  test("fails closed on duplicate or active v68 candidates", () => {
    const stagedWasmFingerprint = {
      sizeBytes: approved.wasmSizeBytes,
      sha256: approved.wasmSha256,
    };
    const candidate = {
      versionTag: approved.versionTag,
      status: "inactive",
      versionId: approved.versionId,
    };

    expect(() => assertApprovedV68ActivationPreflight({
      approvedCandidate: approved,
      versions: [candidate, { ...candidate }],
      stagedWasmFingerprint,
    })).toThrow(/not inactive/i);
    expect(() => assertApprovedV68ActivationPreflight({
      approvedCandidate: approved,
      versions: [{ ...candidate, status: "active" }],
      stagedWasmFingerprint,
    })).toThrow(/not inactive/i);
  });
});
