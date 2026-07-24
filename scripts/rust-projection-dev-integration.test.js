import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { posix, resolve, win32 } from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  TARGET,
  assertActiveCandidateState,
  assertDeployableCandidateVersion,
  assertDeploymentIdentity,
  assertInactiveCandidateState,
  assertPreflightState,
  assertRecoveredBaselineState,
  assertRegistrationStable,
  assertStagedAppInfo,
  executeActivationBoundary,
  executeBaselineRecovery,
  executeInactiveDeploymentBoundary,
  executeModeSetup,
  deploymentCommands,
  executionMode,
  inspectStagedWasmArtifact,
  prepareRustBreadthInventoryReadback,
  resolveStagingPaths,
  renderStagingAppConfig,
  renderStagingManifest,
} from "./rust-projection-dev-integration.js";

const root = resolve(import.meta.dirname, "..");

function stableBinding() {
  return {
    registrations: [{
      id: TARGET.registrationId,
      functionId: TARGET.functionId,
    }],
    allRegistrationsResolve: true,
  };
}

function stateWithVersions(versions) {
  return { ...stableBinding(), versions };
}

describe("Rust hybrid development integration contract", () => {
  test("locks the exact development target and v64 rollback anchor", () => {
    expect(TARGET).toEqual(expect.objectContaining({
      appName: "cart-transform-poc-dev",
      appConfig: "shopify.app.rust-spike-dev.toml",
      clientId: "d25c62f609855572f3f266765d105ebb",
      store: "huang-mvqquz1p.myshopify.com",
      baselineVersion: "cart-transform-poc-dev-64",
      previousCandidateVersion: "cart-transform-poc-dev-67",
      candidateVersion: "cart-transform-poc-dev-68",
      rejectedCandidateVersion: "cart-transform-poc-dev-66",
      candidateMessage: "rust-hybrid-quantity-v2-candidate",
      activationSealed: true,
      registrationId: "gid://shopify/CartTransform/136675606",
      functionId: "019f5e8c-0374-7577-b756-66af47a751be",
      functionHandle: "master-kit-expand",
      functionUid: "67c62dc1-f689-b420-3491-32bd242a5a2d29f7d2c6",
    }));
  });

  test("deploys only v68 and keeps v66/v67 inactive", () => {
    expect(() => assertDeployableCandidateVersion(
      "cart-transform-poc-dev-66",
    )).toThrow(/v66|cart-transform-poc-dev-66/i);
    expect(() => assertDeployableCandidateVersion(
      "cart-transform-poc-dev-67",
    )).toThrow(/v68|cart-transform-poc-dev-68/i);
    expect(() => assertDeployableCandidateVersion(
      "cart-transform-poc-dev-68",
    )).not.toThrow();

    expect(() => assertInactiveCandidateState(stateWithVersions([
      { versionTag: TARGET.baselineVersion, status: "active" },
      { versionTag: TARGET.rejectedCandidateVersion, status: "inactive" },
    ]))).toThrow(/cart-transform-poc-dev-68/i);

    expect(() => assertActiveCandidateState(stateWithVersions([
      { versionTag: TARGET.rejectedCandidateVersion, status: "active" },
      { versionTag: TARGET.candidateVersion, status: "active" },
    ]))).toThrow(/v66|cart-transform-poc-dev-66/i);
  });

  test("accepts only the exact development app identity", () => {
    expect(() => assertDeploymentIdentity({
      appName: TARGET.appName,
      clientId: TARGET.clientId,
      store: TARGET.store,
    })).not.toThrow();
    expect(() => assertDeploymentIdentity({
      appName: "cart-transform-poc",
      clientId: TARGET.clientId,
      store: TARGET.store,
    })).toThrow(/development app identity/i);
  });

  test("requires v68 to be absent and v67 to remain inactive before deployment", () => {
    const state = stateWithVersions([
      { versionTag: TARGET.baselineVersion, status: "active" },
      { versionTag: "cart-transform-poc-dev-65", status: "inactive" },
      { versionTag: TARGET.rejectedCandidateVersion, status: "inactive" },
      { versionTag: TARGET.previousCandidateVersion, status: "inactive" },
    ]);
    expect(() => assertPreflightState(state)).not.toThrow();
    expect(() => assertPreflightState({
      ...state,
      versions: [
        ...state.versions,
        { versionTag: TARGET.candidateVersion, status: "inactive" },
      ],
    })).toThrow(/already exists/i);
    expect(() => assertPreflightState({
      ...state,
      versions: state.versions.map((version) => (
        version.versionTag === TARGET.previousCandidateVersion
          ? { ...version, status: "active" }
          : version
      )),
    })).toThrow(/v67|cart-transform-poc-dev-67/i);
  });

  test("validates inactive, active, and recovered boundaries with stable registration", () => {
    expect(() => assertInactiveCandidateState(stateWithVersions([
      { versionTag: TARGET.baselineVersion, status: "active" },
      { versionTag: TARGET.candidateVersion, status: "inactive" },
    ]))).not.toThrow();
    expect(() => assertActiveCandidateState(stateWithVersions([
      { versionTag: TARGET.baselineVersion, status: "inactive" },
      { versionTag: TARGET.candidateVersion, status: "active" },
    ]))).not.toThrow();
    expect(() => assertRecoveredBaselineState(stateWithVersions([
      { versionTag: TARGET.baselineVersion, status: "active" },
      { versionTag: TARGET.candidateVersion, status: "inactive" },
    ]))).not.toThrow();
    expect(() => assertActiveCandidateState({
      ...stateWithVersions([
        { versionTag: TARGET.baselineVersion, status: "inactive" },
        { versionTag: TARGET.candidateVersion, status: "active" },
      ]),
      allRegistrationsResolve: false,
    })).toThrow(/resolve/i);
  });

  test("rejects registration or Function identity drift", () => {
    const expected = [{ id: TARGET.registrationId, functionId: TARGET.functionId }];
    expect(() => assertRegistrationStable(expected)).not.toThrow();
    expect(() => assertRegistrationStable([])).toThrow(/exactly one/i);
    expect(() => assertRegistrationStable([
      { id: TARGET.registrationId, functionId: "different" },
    ])).toThrow(/Function ID/i);
  });

  test("renders an isolated staged Function with the existing UID and handle", () => {
    const view = renderStagingManifest();
    expect(view).toContain(`uid = "${TARGET.functionUid}"`);
    expect(view).toContain(`handle = "${TARGET.functionHandle}"`);
    expect(view).toContain('target = "purchase.cart-transform.run"');
    expect(view).toContain('path = "dist/index.wasm"');
    expect(view).not.toContain("master-kit-expand-rust-spike");
  });

  test("derives the staging app config from dev config and changes only extension discovery", () => {
    const source = readFileSync(resolve(root, TARGET.sourceAppConfig), "utf8");
    const view = renderStagingAppConfig(source);
    expect(view).toContain(`client_id = "${TARGET.clientId}"`);
    expect(view).toContain('extension_directories = [');
    expect(view).toContain('"extensions/product-builder"');
    expect(view).toContain('".local/rust-projection-dev-integration/extensions/master-kit-expand"');
    expect(view).not.toContain('"extensions/"');
    expect(view).not.toContain("master-kit-expand-rust-spike");
    expect(view.replace(
      /extension_directories = \[\r?\n(?:.*\r?\n)*?\]\r?\n/,
      "",
    )).toBe(source);
  });

  test("resolves every generated deployment file inside the ignored staging root", () => {
    const paths = resolveStagingPaths("C:/repo", win32);
    expect(paths.root).toBe("C:\\repo\\.local\\rust-projection-dev-integration");
    expect(paths.extensionDirectory).toBe(`${paths.root}\\extensions\\master-kit-expand`);
    expect(paths.manifest).toBe(`${paths.extensionDirectory}\\shopify.extension.toml`);
    expect(paths.query).toBe(`${paths.extensionDirectory}\\src\\run.graphql`);
    expect(paths.wasm).toBe(`${paths.extensionDirectory}\\dist\\index.wasm`);
    expect(paths.appConfig).toBe("C:\\repo\\shopify.app.rust-spike-dev.toml");
  });

  test("resolves native Linux staging paths without Windows separators", () => {
    const paths = resolveStagingPaths(
      "/home/devbox/project/cart-transform-poc",
      posix,
    );
    expect(paths.root).toBe(
      "/home/devbox/project/cart-transform-poc/.local/rust-projection-dev-integration",
    );
    expect(paths.extensionDirectory).toBe(
      `${paths.root}/extensions/master-kit-expand`,
    );
    expect(paths.wasm).toBe(`${paths.extensionDirectory}/dist/index.wasm`);
    expect(paths.appConfig).toBe(
      "/home/devbox/project/cart-transform-poc/shopify.app.rust-spike-dev.toml",
    );
  });

  test("defaults to dry-run and enforces one explicit execution mode", () => {
    expect(executionMode([])).toBe("dry-run");
    expect(executionMode(["--deploy-inactive"])).toBe("deploy-inactive");
    expect(executionMode(["--activate-candidate"])).toBe("activate-candidate");
    expect(executionMode(["--recover-v64"])).toBe("recover-v64");
    expect(() => executionMode(["--force"])).toThrow(/unknown argument/i);
    expect(() => executionMode([
      "--deploy-inactive",
      "--activate-candidate",
    ])).toThrow(/mutually exclusive/i);
  });

  test("preflight requires v64 and one resolving stable registration", () => {
    const state = {
      versions: [{ versionTag: TARGET.baselineVersion, status: "active" }],
      registrations: [{ id: TARGET.registrationId, functionId: TARGET.functionId }],
      allRegistrationsResolve: true,
    };
    expect(() => assertPreflightState(state)).not.toThrow();
    expect(() => assertPreflightState({
      ...state,
      versions: [
        ...state.versions,
        { versionTag: TARGET.rejectedCandidateVersion, status: "inactive" },
      ],
    })).not.toThrow();
    expect(() => assertPreflightState({
      ...state,
      versions: [
        ...state.versions,
        { versionTag: TARGET.rejectedCandidateVersion, status: "active" },
      ],
    })).toThrow(/v66|cart-transform-poc-dev-66/i);
    expect(() => assertPreflightState({ ...state, allRegistrationsResolve: false }))
      .toThrow(/resolve/i);
    expect(() => assertPreflightState({
      ...state,
      versions: [{ versionTag: TARGET.baselineVersion, status: "inactive" }],
    })).toThrow(/v64/i);
    expect(() => assertPreflightState({
      ...state,
      versions: [
        ...state.versions,
        { versionTag: TARGET.candidateVersion, status: "inactive" },
      ],
    })).toThrow(/already exists/i);
  });

  test("keeps inactive deployment, activation, and recovery as separate commands", () => {
    const commands = deploymentCommands();
    expect(commands.buildStagedApp).toEqual([
      "app", "build", "--config", TARGET.appConfig,
    ]);
    expect(commands.readVersions).toEqual([
      "app", "versions", "list", "--config", TARGET.sourceAppConfig, "--json",
    ]);
    expect(commands.deployInactive).toEqual(expect.arrayContaining([
      "app", "deploy", "--no-release", "--version", TARGET.candidateVersion,
    ]));
    expect(commands.deployInactive).toContain(TARGET.candidateMessage);
    expect(commands.deployInactive).not.toContain(TARGET.rejectedCandidateVersion);
    expect(commands.deployInactive).not.toContain("--allow-updates");
    expect(commands.activateCandidate).toEqual([
      "app", "release", "--config", TARGET.appConfig,
      "--version", TARGET.candidateVersion, "--allow-updates",
    ]);
    expect(commands.recoverBaseline).toEqual([
      "app", "release", "--config", TARGET.sourceAppConfig,
      "--version", TARGET.baselineVersion, "--allow-updates",
    ]);
    expect(JSON.stringify(commands)).not.toMatch(/cartTransform(Create|Delete)/);
    expect(JSON.stringify(commands)).not.toContain("--allow-deletes");
  });

  test("recovery bypasses missing or invalid candidate staging", () => {
    const invalidCandidateSetup = vi.fn(() => {
      throw new Error("staged config is missing or invalid");
    });

    expect(executeModeSetup({
      mode: "recover-v64",
      prepareCandidate: invalidCandidateSetup,
    })).toEqual({ candidatePrepared: false });
    expect(invalidCandidateSetup).not.toHaveBeenCalled();

    expect(() => executeModeSetup({
      mode: "activate-candidate",
      prepareCandidate: invalidCandidateSetup,
    })).toThrow(/staged config is missing or invalid/i);
    expect(invalidCandidateSetup).toHaveBeenCalledOnce();
  });

  test("rejects a stale staged Wasm and fingerprints the exact hybrid artifact", () => {
    const oldProjection = Buffer.alloc(72_715, 1);
    const currentHybrid = Buffer.alloc(108_602, 2);
    expect(() => inspectStagedWasmArtifact({
      sourceWasm: currentHybrid,
      stagedWasm: oldProjection,
    })).toThrow(/stale staged Wasm/i);

    const fingerprint = inspectStagedWasmArtifact({
      sourceWasm: currentHybrid,
      stagedWasm: Buffer.from(currentHybrid),
    });
    expect(fingerprint).toEqual({
      sizeBytes: 108_602,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  test("accepts Shopify-transformed Wasm only with fresh source-copy provenance", () => {
    const sourceWasm = Buffer.alloc(113_274, 1);
    const stagedWasm = Buffer.alloc(113_274, 2);
    const fingerprint = (bytes) => ({
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });

    expect(inspectStagedWasmArtifact({
      sourceWasm,
      stagedWasm,
      expectedInvocationId: "build-123",
      buildProvenance: {
        schemaVersion: "rust_projection_build_provenance.v1",
        invocationId: "build-123",
        sourceWasm: fingerprint(sourceWasm),
        copiedWasm: fingerprint(sourceWasm),
      },
    })).toEqual(fingerprint(stagedWasm));
  });

  test("rejects transformed Wasm with stale invocation or source provenance", () => {
    const sourceWasm = Buffer.alloc(113_274, 1);
    const stagedWasm = Buffer.alloc(113_274, 2);
    const fingerprint = (bytes) => ({
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const buildProvenance = {
      schemaVersion: "rust_projection_build_provenance.v1",
      invocationId: "old-build",
      sourceWasm: fingerprint(sourceWasm),
      copiedWasm: fingerprint(sourceWasm),
    };

    expect(() => inspectStagedWasmArtifact({
      sourceWasm,
      stagedWasm,
      expectedInvocationId: "current-build",
      buildProvenance,
    })).toThrow(/invocation/i);

    expect(() => inspectStagedWasmArtifact({
      sourceWasm,
      stagedWasm,
      expectedInvocationId: "old-build",
      buildProvenance: {
        ...buildProvenance,
        sourceWasm: fingerprint(Buffer.alloc(113_274, 3)),
      },
    })).toThrow(/source.*fingerprint/i);
  });

  test("inactive deployment performs no release and verifies the full post-write state", () => {
    const deployInactive = vi.fn();
    const readState = vi.fn(() => stateWithVersions([
      { versionTag: TARGET.baselineVersion, status: "active" },
      { versionTag: TARGET.candidateVersion, status: "inactive" },
    ]));

    const result = executeInactiveDeploymentBoundary({ deployInactive, readState });

    expect(deployInactive).toHaveBeenCalledOnce();
    expect(readState).toHaveBeenCalledOnce();
    expect(result.versions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        versionTag: TARGET.baselineVersion,
        status: "active",
      }),
      expect.objectContaining({
        versionTag: TARGET.candidateVersion,
        status: "inactive",
      }),
    ]));
  });

  test("inactive deployment still reads versions and binding when the CLI command fails", () => {
    const deploymentError = new Error("deploy transport failed");
    const readState = vi.fn(() => stateWithVersions([
      { versionTag: TARGET.baselineVersion, status: "active" },
    ]));

    expect(() => executeInactiveDeploymentBoundary({
      deployInactive: () => {
        throw deploymentError;
      },
      readState,
    })).toThrow(deploymentError);
    expect(readState).toHaveBeenCalledOnce();
  });

  test("inactive deployment retries bounded post-write state reads", () => {
    const deployInactive = vi.fn();
    const readState = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error("OAuth token transport failed");
      })
      .mockImplementationOnce(() => {
        throw new Error("OAuth token transport failed again");
      })
      .mockReturnValue(stateWithVersions([
        { versionTag: TARGET.baselineVersion, status: "active" },
        { versionTag: TARGET.candidateVersion, status: "inactive" },
      ]));

    const result = executeInactiveDeploymentBoundary({
      deployInactive,
      readState,
    });

    expect(deployInactive).toHaveBeenCalledOnce();
    expect(readState).toHaveBeenCalledTimes(3);
    expect(result.versions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        versionTag: TARGET.candidateVersion,
        status: "inactive",
      }),
    ]));
  });

  test("inactive deployment bounds failed post-write state reads without redeploying", () => {
    const deployInactive = vi.fn();
    const readState = vi.fn(() => {
      throw new Error("OAuth token transport failed");
    });

    expect(() => executeInactiveDeploymentBoundary({
      deployInactive,
      readState,
    })).toThrow(/Post-deployment state read failed after 3 attempts/i);
    expect(deployInactive).toHaveBeenCalledOnce();
    expect(readState).toHaveBeenCalledTimes(3);
  });

  test("activation failure automatically attempts verified v64 recovery", () => {
    const activationError = new Error("release failed");
    const activateCandidate = vi.fn(() => {
      throw activationError;
    });
    const recoverBaseline = vi.fn();
    const states = [
      stateWithVersions([
        { versionTag: TARGET.baselineVersion, status: "inactive" },
        { versionTag: TARGET.candidateVersion, status: "active" },
      ]),
      stateWithVersions([
        { versionTag: TARGET.baselineVersion, status: "active" },
        { versionTag: TARGET.candidateVersion, status: "inactive" },
      ]),
    ];
    const readState = vi.fn(() => states.shift());

    expect(() => executeActivationBoundary({
      activateCandidate,
      readState,
      recoverBaseline,
    })).toThrow(activationError);
    expect(recoverBaseline).toHaveBeenCalledOnce();
    expect(readState).toHaveBeenCalledTimes(2);
  });

  test("activation failure forces idempotent v64 recovery despite a stale active-baseline read", () => {
    const activationError = new Error("release result unknown");
    const recoverBaseline = vi.fn();
    const staleBaselineState = stateWithVersions([
      { versionTag: TARGET.baselineVersion, status: "active" },
      { versionTag: TARGET.candidateVersion, status: "inactive" },
    ]);
    const readState = vi.fn(() => staleBaselineState);

    expect(() => executeActivationBoundary({
      activateCandidate: () => {
        throw activationError;
      },
      readState,
      recoverBaseline,
    })).toThrow(activationError);

    expect(recoverBaseline).toHaveBeenCalledOnce();
    expect(readState).toHaveBeenCalledTimes(2);
  });

  test("ambiguous activation retries failed state reads, then idempotently recovers and verifies v64", () => {
    const activationError = new Error("release transport result unknown");
    const recoverBaseline = vi.fn();
    const readState = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error("state read 1 failed");
      })
      .mockImplementationOnce(() => {
        throw new Error("state read 2 failed");
      })
      .mockImplementationOnce(() => {
        throw new Error("state read 3 failed");
      })
      .mockImplementationOnce(() => stateWithVersions([
        { versionTag: TARGET.baselineVersion, status: "active" },
        { versionTag: TARGET.candidateVersion, status: "inactive" },
      ]));

    expect(() => executeActivationBoundary({
      activateCandidate: () => {
        throw activationError;
      },
      readState,
      recoverBaseline,
    })).toThrow(activationError);

    expect(readState).toHaveBeenCalledTimes(4);
    expect(recoverBaseline).toHaveBeenCalledOnce();
    expect(readState.mock.invocationCallOrder[3])
      .toBeGreaterThan(recoverBaseline.mock.invocationCallOrder[0]);
  });

  test("successful activation remains active and reports recovery as required", () => {
    const activateCandidate = vi.fn();
    const recoverBaseline = vi.fn();
    const readState = vi.fn(() => stateWithVersions([
      { versionTag: TARGET.baselineVersion, status: "inactive" },
      { versionTag: TARGET.candidateVersion, status: "active" },
    ]));

    const result = executeActivationBoundary({
      activateCandidate,
      readState,
      recoverBaseline,
    });

    expect(recoverBaseline).not.toHaveBeenCalled();
    expect(result.recoveryRequired).toBe(true);
  });

  test("successful activation retries post-release reads without unnecessary recovery", () => {
    const activateCandidate = vi.fn();
    const recoverBaseline = vi.fn();
    const readState = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error("OAuth token transport failed");
      })
      .mockImplementationOnce(() => {
        throw new Error("OAuth token transport failed again");
      })
      .mockReturnValue(stateWithVersions([
        { versionTag: TARGET.baselineVersion, status: "inactive" },
        { versionTag: TARGET.candidateVersion, status: "active" },
      ]));

    const result = executeActivationBoundary({
      activateCandidate,
      readState,
      recoverBaseline,
    });

    expect(activateCandidate).toHaveBeenCalledOnce();
    expect(readState).toHaveBeenCalledTimes(3);
    expect(recoverBaseline).not.toHaveBeenCalled();
    expect(result.recoveryRequired).toBe(true);
  });

  test("v64 recovery is idempotent from active baseline and restores active candidate", () => {
    const recoverBaseline = vi.fn();
    const alreadyRecovered = executeBaselineRecovery({
      recoverBaseline,
      readState: vi.fn(() => stateWithVersions([
        { versionTag: TARGET.baselineVersion, status: "active" },
        { versionTag: TARGET.candidateVersion, status: "inactive" },
      ])),
    });
    expect(recoverBaseline).not.toHaveBeenCalled();
    expect(alreadyRecovered.recoveryExecuted).toBe(false);

    const states = [
      stateWithVersions([
        { versionTag: TARGET.baselineVersion, status: "inactive" },
        { versionTag: TARGET.candidateVersion, status: "active" },
      ]),
      stateWithVersions([
        { versionTag: TARGET.baselineVersion, status: "active" },
        { versionTag: TARGET.candidateVersion, status: "inactive" },
      ]),
    ];
    const restored = executeBaselineRecovery({
      recoverBaseline,
      readState: vi.fn(() => states.shift()),
    });
    expect(recoverBaseline).toHaveBeenCalledOnce();
    expect(restored.recoveryExecuted).toBe(true);
  });

  test("v64 recovery reads post-command state even when the release command fails", () => {
    const states = [
      stateWithVersions([
        { versionTag: TARGET.baselineVersion, status: "inactive" },
        { versionTag: TARGET.candidateVersion, status: "active" },
      ]),
      stateWithVersions([
        { versionTag: TARGET.baselineVersion, status: "inactive" },
        { versionTag: TARGET.candidateVersion, status: "active" },
      ]),
    ];
    const readState = vi.fn(() => states.shift());

    expect(() => executeBaselineRecovery({
      recoverBaseline: () => {
        throw new Error("rollback transport failed");
      },
      readState,
    })).toThrow(/could not be verified/i);
    expect(readState).toHaveBeenCalledTimes(2);
  });

  test("v64 recovery bounds independent post-command readback retries", () => {
    const recoverBaseline = vi.fn();
    const readState = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error("pre-recovery read 1 failed");
      })
      .mockImplementationOnce(() => {
        throw new Error("pre-recovery read 2 failed");
      })
      .mockImplementationOnce(() => {
        throw new Error("pre-recovery read 3 failed");
      })
      .mockImplementationOnce(() => {
        throw new Error("post-recovery read 1 failed");
      })
      .mockImplementationOnce(() => {
        throw new Error("post-recovery read 2 failed");
      })
      .mockImplementationOnce(() => {
        throw new Error("post-recovery read 3 failed");
      });

    expect(() => executeBaselineRecovery({
      recoverBaseline,
      readState,
    })).toThrow(/could not be verified/i);

    expect(recoverBaseline).toHaveBeenCalledOnce();
    expect(readState).toHaveBeenCalledTimes(6);
  });

  test("requires exactly the staged Rust Function and existing Theme extension", () => {
    const info = {
      name: TARGET.appName,
      configuration: { client_id: TARGET.clientId },
      _hiddenConfig: { dev_store_url: TARGET.store },
      allExtensions: [
        { specification: { identifier: "theme" }, uid: "theme-uid" },
        {
          specification: { identifier: "function" },
          uid: TARGET.functionUid,
          handle: TARGET.functionHandle,
          directory: `C:/repo/${TARGET.stagingDirectory}`,
        },
      ],
    };
    expect(() => assertStagedAppInfo(info)).not.toThrow();
    expect(() => assertStagedAppInfo({
      ...info,
      allExtensions: [...info.allExtensions, {
        specification: { identifier: "function" },
        uid: "unexpected",
        handle: "unexpected",
      }],
    })).toThrow(/exactly one Function/i);
  });

  test("selects only 10/12 component records and excludes parent inventory", () => {
    const record = (parentSku, componentSku) => ({
      parent_sku: parentSku,
      parent: { sku: parentSku, role: "parent" },
      components: [{ sku: componentSku, role: "component" }],
    });
    const result = prepareRustBreadthInventoryReadback({
      schema_version: "dev_catalog_technical_batch_live_readback.v2",
      store_domain: TARGET.store,
      records: [
        record("AS2014B-BT", "AS2038"),
        record("AS2014B2-FK-4005P", "AF4005P"),
        record("AS2014B2-MK-2011-4005P", "AD2011"),
      ],
    });
    expect(result.batch_id).toBe("rust-hybrid-breadth-v67-10-12");
    expect(result.records.map(({ parent_sku }) => parent_sku)).toEqual([
      "AS2014B2-FK-4005P",
      "AS2014B2-MK-2011-4005P",
    ]);
    expect(result.records.every(({ parent }) => parent === null)).toBe(true);
    expect(result.records.flatMap(({ components }) => components.map(({ sku }) => sku)))
      .not.toContain("AS2038");
  });
});
