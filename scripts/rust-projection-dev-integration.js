import { createHash } from "node:crypto";
import * as nativePath from "node:path";

export const TARGET = Object.freeze({
  appName: "cart-transform-poc-dev",
  appConfig: "shopify.app.rust-spike-dev.toml",
  sourceAppConfig: "shopify.app.dev.toml",
  clientId: "d25c62f609855572f3f266765d105ebb",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
  baselineVersion: "cart-transform-poc-dev-64",
  previousCandidateVersion: "cart-transform-poc-dev-67",
  candidateVersion: "cart-transform-poc-dev-68",
  rejectedCandidateVersion: "cart-transform-poc-dev-66",
  candidateMessage: "rust-hybrid-quantity-v2-candidate",
  activationSealed: false,
  registrationId: "gid://shopify/CartTransform/136675606",
  functionId: "019f5e8c-0374-7577-b756-66af47a751be",
  functionHandle: "master-kit-expand",
  functionUid: "67c62dc1-f689-b420-3491-32bd242a5a2d29f7d2c6",
  stagingDirectory: ".local/rust-projection-dev-integration/extensions/master-kit-expand",
});

export function assertDeploymentIdentity(identity) {
  if (
    identity?.appName !== TARGET.appName
    || identity?.clientId !== TARGET.clientId
    || identity?.store !== TARGET.store
  ) {
    throw new Error(`Unexpected development app identity: ${JSON.stringify(identity)}.`);
  }
}

function versionWithStatus(versions, versionTag, status) {
  return versions.find((version) => (
    version.versionTag === versionTag && version.status === status
  ));
}

export function assertDeployableCandidateVersion(versionTag) {
  if (versionTag === TARGET.rejectedCandidateVersion) {
    throw new Error(
      `${TARGET.rejectedCandidateVersion} is rejected as a deployment or activation candidate.`,
    );
  }
  if (versionTag !== TARGET.candidateVersion) {
    throw new Error(`Deployable candidate must be ${TARGET.candidateVersion}; received ${versionTag}.`);
  }
  return versionTag;
}

function assertRejectedCandidateInactive(versions) {
  for (const versionTag of [
    TARGET.rejectedCandidateVersion,
    TARGET.previousCandidateVersion,
  ]) {
    if (versionWithStatus(versions, versionTag, "active")) {
      throw new Error(`${versionTag} must remain inactive.`);
    }
  }
}

function combinedBoundaryError(message, errors) {
  const error = new Error(message, { cause: errors[0] });
  error.errors = errors;
  return error;
}

const BOUNDARY_READ_ATTEMPTS = 3;

function readStateWithRetries(readState, description) {
  const errors = [];
  for (let attempt = 1; attempt <= BOUNDARY_READ_ATTEMPTS; attempt += 1) {
    try {
      return readState();
    } catch (error) {
      errors.push(error);
    }
  }
  throw combinedBoundaryError(
    `${description} failed after ${BOUNDARY_READ_ATTEMPTS} attempts.`,
    errors,
  );
}

export function assertInactiveCandidate(versions) {
  assertDeployableCandidateVersion(TARGET.candidateVersion);
  assertRejectedCandidateInactive(versions);
  if (!versionWithStatus(versions, TARGET.baselineVersion, "active")) {
    throw new Error(`Expected v64 rollback anchor ${TARGET.baselineVersion} to remain active.`);
  }
  if (!versionWithStatus(versions, TARGET.candidateVersion, "inactive")) {
    throw new Error(`Expected candidate ${TARGET.candidateVersion} to be inactive.`);
  }
}

export function assertActiveCandidate(versions) {
  assertDeployableCandidateVersion(TARGET.candidateVersion);
  assertRejectedCandidateInactive(versions);
  if (!versionWithStatus(versions, TARGET.candidateVersion, "active")) {
    throw new Error(`Expected candidate ${TARGET.candidateVersion} to be active.`);
  }
}

function assertResolvingStableRegistration(state) {
  assertRegistrationStable(state.registrations);
  if (state.allRegistrationsResolve !== true) {
    throw new Error("The Cart Transform registration does not resolve.");
  }
}

export function assertInactiveCandidateState(state) {
  assertInactiveCandidate(state.versions);
  assertResolvingStableRegistration(state);
}

export function assertActiveCandidateState(state) {
  assertActiveCandidate(state.versions);
  assertResolvingStableRegistration(state);
}

export function assertRecoveredBaselineState(state) {
  if (!versionWithStatus(state.versions, TARGET.baselineVersion, "active")) {
    throw new Error(`Expected ${TARGET.baselineVersion} to be active after recovery.`);
  }
  assertResolvingStableRegistration(state);
}

export function assertRegistrationStable(registrations) {
  if (registrations.length !== 1) {
    throw new Error(`Expected exactly one Cart Transform registration; found ${registrations.length}.`);
  }
  const [registration] = registrations;
  if (registration.id !== TARGET.registrationId) {
    throw new Error(`Unexpected Cart Transform registration ID ${registration.id}.`);
  }
  if (registration.functionId !== TARGET.functionId) {
    throw new Error(`Unexpected Cart Transform Function ID ${registration.functionId}.`);
  }
}

export function renderStagingManifest() {
  return `api_version = "${TARGET.apiVersion}"

[[extensions]]
name = "Master Kit Expand"
handle = "${TARGET.functionHandle}"
uid = "${TARGET.functionUid}"
type = "function"
description = "Development-only Rust hybrid candidate"

[[extensions.targeting]]
target = "purchase.cart-transform.run"
input_query = "src/run.graphql"
export = "run"

[extensions.build]
command = "node ../../../../scripts/build-rust-projection-function.mjs --output dist/index.wasm"
path = "dist/index.wasm"
`;
}

export function renderStagingAppConfig(sourceAppConfig) {
  if (typeof sourceAppConfig !== "string" || sourceAppConfig.length === 0) {
    throw new Error("The source development app configuration is required.");
  }
  const newline = sourceAppConfig.includes("\r\n") ? "\r\n" : "\n";
  const block = `extension_directories = [${newline}`
    + `  "extensions/product-builder",${newline}`
    + `  "${TARGET.stagingDirectory}"${newline}`
    + `]${newline}`;
  const existing = /^extension_directories\s*=\s*\[[\s\S]*?^\](?:\r?\n)?/m;
  if (existing.test(sourceAppConfig)) {
    return sourceAppConfig.replace(existing, block);
  }
  const clientIdLine = /^client_id\s*=.*(?:\r?\n|$)/m;
  if (!clientIdLine.test(sourceAppConfig)) {
    throw new Error("The source development app configuration has no client_id.");
  }
  return sourceAppConfig.replace(clientIdLine, (line) => `${line}${block}`);
}

export function resolveStagingPaths(repoRoot, pathImplementation = nativePath) {
  const root = pathImplementation.join(
    repoRoot,
    ".local",
    "rust-projection-dev-integration",
  );
  const extensionDirectory = pathImplementation.join(
    root,
    "extensions",
    "master-kit-expand",
  );
  return Object.freeze({
    root,
    extensionDirectory,
    manifest: pathImplementation.join(extensionDirectory, "shopify.extension.toml"),
    query: pathImplementation.join(extensionDirectory, "src", "run.graphql"),
    wasm: pathImplementation.join(extensionDirectory, "dist", "index.wasm"),
    appConfig: pathImplementation.join(repoRoot, TARGET.appConfig),
  });
}

export function executionMode(args) {
  const modes = Object.freeze({
    "--deploy-inactive": "deploy-inactive",
    "--activate-candidate": "activate-candidate",
    "--recover-v64": "recover-v64",
  });
  const unknown = args.filter((argument) => !(argument in modes));
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(", ")}.`);
  if (args.length > 1) {
    throw new Error("Execution modes are mutually exclusive.");
  }
  const mode = args.length === 0 ? "dry-run" : modes[args[0]];
  if (mode === "activate-candidate" && !TARGET.activationSealed) {
    throw new Error(
      "v68 activation is not sealed; deploy and read back the inactive candidate first.",
    );
  }
  return mode;
}

export function executeModeSetup({ mode, prepareCandidate }) {
  if (mode === "recover-v64") {
    return { candidatePrepared: false };
  }
  prepareCandidate();
  return { candidatePrepared: true };
}

export function assertPreflightState(state) {
  assertDeployableCandidateVersion(TARGET.candidateVersion);
  assertRejectedCandidateInactive(state.versions);
  if (!versionWithStatus(state.versions, TARGET.baselineVersion, "active")) {
    throw new Error(`Expected v64 rollback anchor ${TARGET.baselineVersion} to be active.`);
  }
  if (state.versions.some(({ versionTag }) => versionTag === TARGET.candidateVersion)) {
    throw new Error(`Candidate ${TARGET.candidateVersion} already exists.`);
  }
  assertResolvingStableRegistration(state);
}

export function deploymentCommands() {
  return Object.freeze({
    buildStagedApp: [
      "app",
      "build",
      "--config",
      TARGET.appConfig,
    ],
    readVersions: [
      "app",
      "versions",
      "list",
      "--config",
      TARGET.sourceAppConfig,
      "--json",
    ],
    deployInactive: [
      "app",
      "deploy",
      "--config",
      TARGET.appConfig,
      "--no-release",
      "--version",
      TARGET.candidateVersion,
      "--message",
      TARGET.candidateMessage,
    ],
    activateCandidate: [
      "app",
      "release",
      "--config",
      TARGET.appConfig,
      "--version",
      TARGET.candidateVersion,
      "--allow-updates",
    ],
    recoverBaseline: [
      "app",
      "release",
      "--config",
      TARGET.sourceAppConfig,
      "--version",
      TARGET.baselineVersion,
      "--allow-updates",
    ],
  });
}

export function inspectStagedWasmArtifact({
  sourceWasm,
  stagedWasm,
  buildProvenance,
  expectedInvocationId,
}) {
  if (!Buffer.isBuffer(sourceWasm) || !Buffer.isBuffer(stagedWasm)) {
    throw new Error("Source and staged Wasm artifacts must be Buffers.");
  }
  const sha256 = (content) => createHash("sha256").update(content).digest("hex");
  const sourceSha256 = sha256(sourceWasm);
  const stagedSha256 = sha256(stagedWasm);
  if (buildProvenance || expectedInvocationId) {
    if (!buildProvenance || !expectedInvocationId) {
      throw new Error("Transformed staged Wasm requires build provenance and an invocation ID.");
    }
    if (buildProvenance.schemaVersion !== "rust_projection_build_provenance.v1") {
      throw new Error("Rust build provenance schema is invalid.");
    }
    if (buildProvenance.invocationId !== expectedInvocationId) {
      throw new Error("Rust build provenance invocation does not match this build.");
    }
    const sourceFingerprint = {
      sizeBytes: sourceWasm.length,
      sha256: sourceSha256,
    };
    if (
      buildProvenance.sourceWasm?.sizeBytes !== sourceFingerprint.sizeBytes
      || buildProvenance.sourceWasm?.sha256 !== sourceFingerprint.sha256
    ) {
      throw new Error("Rust build provenance source fingerprint is stale.");
    }
    if (
      buildProvenance.copiedWasm?.sizeBytes !== sourceFingerprint.sizeBytes
      || buildProvenance.copiedWasm?.sha256 !== sourceFingerprint.sha256
    ) {
      throw new Error("Rust build provenance copied fingerprint does not match the source.");
    }
    return {
      sizeBytes: stagedWasm.length,
      sha256: stagedSha256,
    };
  }
  if (
    stagedWasm.length !== sourceWasm.length
    || stagedSha256 !== sourceSha256
  ) {
    throw new Error(
      `Stale staged Wasm: source=${sourceWasm.length}/${sourceSha256} `
      + `staged=${stagedWasm.length}/${stagedSha256}.`,
    );
  }
  return {
    sizeBytes: stagedWasm.length,
    sha256: stagedSha256,
  };
}

export function executeInactiveDeploymentBoundary({ deployInactive, readState }) {
  let deploymentError;
  try {
    deployInactive();
  } catch (error) {
    deploymentError = error;
  }
  const state = readState();
  if (deploymentError) {
    try {
      if (versionWithStatus(state.versions, TARGET.candidateVersion, "inactive")) {
        assertInactiveCandidateState(state);
      } else {
        assertRecoveredBaselineState(state);
      }
    } catch (verificationError) {
      throw combinedBoundaryError(
        "Inactive candidate deployment failed and the post-command state is unsafe.",
        [deploymentError, verificationError],
      );
    }
    throw deploymentError;
  }
  assertInactiveCandidateState(state);
  return state;
}

export function executeActivationBoundary({
  activateCandidate,
  readState,
  recoverBaseline,
}) {
  try {
    activateCandidate();
    const state = readState();
    assertActiveCandidateState(state);
    return { ...state, recoveryRequired: true };
  } catch (activationError) {
    try {
      executeBaselineRecovery({
        recoverBaseline,
        readState,
        forceRecovery: true,
      });
    } catch (recoveryError) {
      throw combinedBoundaryError(
        `Candidate activation failed and ${TARGET.baselineVersion} recovery could not be verified.`,
        [activationError, recoveryError],
      );
    }
    throw activationError;
  }
}

export function executeBaselineRecovery({
  recoverBaseline,
  readState,
  forceRecovery = false,
}) {
  let before;
  let preRecoveryReadError;
  try {
    before = readStateWithRetries(readState, "Pre-recovery state read");
  } catch (error) {
    preRecoveryReadError = error;
  }
  if (before) {
    if (versionWithStatus(before.versions, TARGET.baselineVersion, "active")) {
      assertRecoveredBaselineState(before);
      if (!forceRecovery) {
        return { ...before, recoveryExecuted: false };
      }
    } else if (!versionWithStatus(before.versions, TARGET.candidateVersion, "active")) {
      throw new Error(
        `Recovery requires ${TARGET.candidateVersion} or ${TARGET.baselineVersion} to be active.`,
      );
    }
  }
  let recoveryError;
  try {
    recoverBaseline();
  } catch (error) {
    recoveryError = error;
  }
  let after;
  try {
    after = readStateWithRetries(readState, "Post-recovery state read");
    assertRecoveredBaselineState(after);
  } catch (verificationError) {
    if (preRecoveryReadError || recoveryError) {
      throw combinedBoundaryError(
        `${TARGET.baselineVersion} recovery could not be verified.`,
        [
          ...(preRecoveryReadError ? [preRecoveryReadError] : []),
          ...(recoveryError ? [recoveryError] : []),
          verificationError,
        ],
      );
    }
    throw verificationError;
  }
  return {
    ...after,
    recoveryExecuted: true,
    ...(preRecoveryReadError ? { preRecoveryReadError: preRecoveryReadError.message } : {}),
    ...(recoveryError ? { recoveryCommandError: recoveryError.message } : {}),
  };
}

export function assertStagedAppInfo(info) {
  assertDeploymentIdentity({
    appName: info?.name,
    clientId: info?.configuration?.client_id,
    store: info?._hiddenConfig?.dev_store_url,
  });
  const extensions = info?.allExtensions ?? [];
  const functions = extensions.filter(({ specification }) => specification?.identifier === "function");
  const themes = extensions.filter(({ specification }) => specification?.identifier === "theme");
  if (functions.length !== 1) {
    throw new Error(`Expected exactly one Function in staged app info; found ${functions.length}.`);
  }
  if (themes.length !== 1) {
    throw new Error(`Expected exactly one Theme extension in staged app info; found ${themes.length}.`);
  }
  const [candidate] = functions;
  if (candidate.uid !== TARGET.functionUid || candidate.handle !== TARGET.functionHandle) {
    throw new Error(`Unexpected staged Function identity: ${JSON.stringify(candidate)}.`);
  }
  const directory = candidate.directory?.replaceAll("\\", "/") ?? "";
  if (!directory.endsWith(TARGET.stagingDirectory)) {
    throw new Error(`Staged Function is outside the isolated directory: ${directory}.`);
  }
}

export function prepareRustBreadthInventoryReadback(liveReadback) {
  if (
    liveReadback?.schema_version !== "dev_catalog_technical_batch_live_readback.v2"
    || liveReadback?.store_domain !== TARGET.store
    || !Array.isArray(liveReadback.records)
  ) {
    throw new Error("Rust breadth inventory requires the exact development live read-back.");
  }
  const targetSkus = ["AS2014B2-FK-4005P", "AS2014B2-MK-2011-4005P"];
  const bySku = new Map(liveReadback.records.map((record) => [record.parent_sku, record]));
  const records = targetSkus.map((parentSku) => {
    const record = bySku.get(parentSku);
    if (!record || !Array.isArray(record.components)) {
      throw new Error(`Missing Rust breadth inventory record ${parentSku}.`);
    }
    return { ...record, parent: null };
  });
  return {
    ...liveReadback,
    batch_id: "rust-hybrid-breadth-v67-10-12",
    records,
  };
}
