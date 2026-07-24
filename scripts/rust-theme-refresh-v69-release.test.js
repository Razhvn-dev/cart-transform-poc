import { describe, expect, test, vi } from "vitest";

import {
  TARGET,
  assertActivationPreflight,
  assertArtifactIdentity,
  assertPreflightState,
  createApprovedCandidateManifest,
  deploymentCommands,
  executeActivationBoundary,
} from "./rust-theme-refresh-v69-release.js";

const registration = {
  id: "gid://shopify/CartTransform/136675606",
  functionId: "019f5e8c-0374-7577-b756-66af47a751be",
};

function stateWithVersions(versions) {
  return {
    versions,
    registrations: [registration],
    allRegistrationsResolve: true,
  };
}

describe("Rust v69 Theme refresh release boundary", () => {
  test("locks the development target, v68 recovery anchor, and exact v69 artifacts", () => {
    expect(TARGET).toEqual(expect.objectContaining({
      appName: "cart-transform-poc-dev",
      sourceAppConfig: "shopify.app.dev.toml",
      stagingAppConfig: "shopify.app.rust-spike-dev.toml",
      clientId: "d25c62f609855572f3f266765d105ebb",
      store: "huang-mvqquz1p.myshopify.com",
      baselineVersion: "cart-transform-poc-dev-68",
      legacyRollbackVersion: "cart-transform-poc-dev-64",
      candidateVersion: "cart-transform-poc-dev-69",
      functionWasm: {
        sizeBytes: 113274,
        sha256: "2ba39091bd4be734eb3faa0f739bf08c7cc29007cd2e21cf868187754e43b521",
      },
      themeSource: {
        sizeBytes: 2792,
        sha256: "9db5613bea189dfab68bebe71d0fae83e079d5e85f53f21b6a6e8d4a974be5f8",
      },
    }));
  });

  test("requires v68 active, v64 retained, v69 absent, and the stable registration", () => {
    expect(() => assertPreflightState(stateWithVersions([
      { versionTag: TARGET.baselineVersion, status: "active" },
      { versionTag: TARGET.legacyRollbackVersion, status: "inactive" },
    ]))).not.toThrow();

    expect(() => assertPreflightState(stateWithVersions([
      { versionTag: TARGET.legacyRollbackVersion, status: "active" },
      { versionTag: TARGET.baselineVersion, status: "inactive" },
    ]))).toThrow(/v68/i);
    expect(() => assertPreflightState(stateWithVersions([
      { versionTag: TARGET.baselineVersion, status: "active" },
    ]))).toThrow(/v64/i);
    expect(() => assertPreflightState(stateWithVersions([
      { versionTag: TARGET.baselineVersion, status: "active" },
      { versionTag: TARGET.legacyRollbackVersion, status: "inactive" },
      { versionTag: TARGET.candidateVersion, status: "inactive" },
    ]))).toThrow(/already exists/i);
  });

  test("creates only an inactive v69 and recovers by releasing v68", () => {
    expect(deploymentCommands()).toEqual(expect.objectContaining({
      deployInactive: expect.arrayContaining([
        "--no-release",
        "--version",
        TARGET.candidateVersion,
      ]),
      activateCandidate: expect.arrayContaining([
        "--version",
        TARGET.candidateVersion,
      ]),
      recoverBaseline: expect.arrayContaining([
        "--version",
        TARGET.baselineVersion,
      ]),
    }));
  });

  test("rejects any Function Wasm or Theme source drift", () => {
    expect(() => assertArtifactIdentity({
      functionWasm: TARGET.functionWasm,
      themeSource: TARGET.themeSource,
    })).not.toThrow();
    expect(() => assertArtifactIdentity({
      functionWasm: { ...TARGET.functionWasm, sizeBytes: 1 },
      themeSource: TARGET.themeSource,
    })).toThrow(/Wasm/i);
    expect(() => assertArtifactIdentity({
      functionWasm: TARGET.functionWasm,
      themeSource: { ...TARGET.themeSource, sha256: "0".repeat(64) },
    })).toThrow(/Theme/i);
  });

  test("binds activation to the read-back v69 Version ID and both artifact fingerprints", () => {
    const versions = [
      { versionTag: TARGET.baselineVersion, status: "active" },
      { versionTag: TARGET.legacyRollbackVersion, status: "inactive" },
      {
        versionTag: TARGET.candidateVersion,
        versionId: "gid://shopify/Version/1063000000001",
        status: "inactive",
      },
    ];
    const manifest = createApprovedCandidateManifest({
      versions,
      functionWasm: TARGET.functionWasm,
      themeSource: TARGET.themeSource,
    });

    expect(manifest).toEqual({
      schemaVersion: "rust_theme_refresh_dev_approved_candidate.v1",
      versionTag: TARGET.candidateVersion,
      versionId: "gid://shopify/Version/1063000000001",
      functionWasm: TARGET.functionWasm,
      themeSource: TARGET.themeSource,
    });
    expect(() => assertActivationPreflight({
      manifest,
      versions,
      functionWasm: TARGET.functionWasm,
      themeSource: TARGET.themeSource,
    })).not.toThrow();
    expect(() => assertActivationPreflight({
      manifest,
      versions: versions.map((version) => (
        version.versionTag === TARGET.candidateVersion
          ? { ...version, versionId: "gid://shopify/Version/999" }
          : version
      )),
      functionWasm: TARGET.functionWasm,
      themeSource: TARGET.themeSource,
    })).toThrow(/Version ID/i);
  });

  test("activation failure performs and verifies an automatic v68 recovery", () => {
    const activationError = new Error("release transport failed");
    const recoverBaseline = vi.fn();
    const recoveredState = stateWithVersions([
      { versionTag: TARGET.candidateVersion, status: "inactive" },
      { versionTag: TARGET.baselineVersion, status: "active" },
      { versionTag: TARGET.legacyRollbackVersion, status: "inactive" },
    ]);

    expect(() => executeActivationBoundary({
      activateCandidate: () => {
        throw activationError;
      },
      recoverBaseline,
      readState: vi.fn(() => recoveredState),
    })).toThrow(activationError);
    expect(recoverBaseline).toHaveBeenCalledOnce();
  });
});
