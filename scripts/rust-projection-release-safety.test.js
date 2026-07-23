import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import {
  assertApprovedV67ActivationPreflight,
} from "./rust-projection-v67-activation-preflight.js";

const root = resolve(import.meta.dirname, "..");
const approved = Object.freeze({
  schemaVersion: "rust_projection_dev_approved_candidate.v1",
  versionTag: "cart-transform-poc-dev-67",
  versionId: "gid://shopify/Version/1061480300545",
  wasmSizeBytes: 108602,
  wasmSha256: "16c43cd42cbaeaafe0c5d9b580c491678702527e144432b6039df97c19dc86c6",
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

  test("binds v67 activation to the approved Version ID and Wasm fingerprint", () => {
    const deployRunner = readFileSync(
      resolve(root, "scripts/deploy-dev-rust-projection.mjs"),
      "utf8",
    );
    const approvedCandidate = JSON.parse(readFileSync(
      resolve(root, "scripts/rust-projection-v67-approved-candidate.json"),
      "utf8",
    ));
    const stagedWasmFingerprint = {
      sizeBytes: approved.wasmSizeBytes,
      sha256: approved.wasmSha256,
    };

    expect(deployRunner).toContain("assertApprovedV67ActivationPreflight");
    expect(approvedCandidate).toEqual(approved);
    expect(assertApprovedV67ActivationPreflight({
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

  test("fails closed on a different v67 Version ID or Wasm fingerprint", () => {
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

    expect(() => assertApprovedV67ActivationPreflight({
      ...base,
      versions: [{
        versionTag: approved.versionTag,
        status: "inactive",
        id: "gid://shopify/Version/999",
      }],
    })).toThrow(/Version ID/i);
    expect(() => assertApprovedV67ActivationPreflight({
      ...base,
      stagedWasmFingerprint: {
        sizeBytes: approved.wasmSizeBytes - 1,
        sha256: approved.wasmSha256,
      },
    })).toThrow(/Wasm/i);
  });

  test("fails closed when versions list omits the live candidate GID", () => {
    expect(() => assertApprovedV67ActivationPreflight({
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

    expect(() => assertApprovedV67ActivationPreflight({
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
});
