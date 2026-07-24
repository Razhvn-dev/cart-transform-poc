import { createHash } from "node:crypto";

export const TARGET = Object.freeze({
  appName: "cart-transform-poc-dev",
  sourceAppConfig: "shopify.app.dev.toml",
  stagingAppConfig: "shopify.app.rust-spike-dev.toml",
  clientId: "d25c62f609855572f3f266765d105ebb",
  store: "huang-mvqquz1p.myshopify.com",
  baselineVersion: "cart-transform-poc-dev-68",
  legacyRollbackVersion: "cart-transform-poc-dev-64",
  candidateVersion: "cart-transform-poc-dev-69",
  candidateMessage: "projection-driven-theme-parent-binding",
  registrationId: "gid://shopify/CartTransform/136675606",
  functionId: "019f5e8c-0374-7577-b756-66af47a751be",
  functionWasm: Object.freeze({
    sizeBytes: 113274,
    sha256: "2ba39091bd4be734eb3faa0f739bf08c7cc29007cd2e21cf868187754e43b521",
  }),
  themeSource: Object.freeze({
    sizeBytes: 2792,
    sha256: "9db5613bea189dfab68bebe71d0fae83e079d5e85f53f21b6a6e8d4a974be5f8",
  }),
});

const MANIFEST_SCHEMA = "rust_theme_refresh_dev_approved_candidate.v1";
const READ_ATTEMPTS = 3;

function versionWithStatus(versions, versionTag, status) {
  return versions.find((version) => (
    version.versionTag === versionTag && version.status === status
  ));
}

function requireVersions(state) {
  if (!Array.isArray(state?.versions)) {
    throw new Error("The development app version list is required.");
  }
  return state.versions;
}

function assertStableRegistration(state) {
  if (state?.registrations?.length !== 1) {
    throw new Error(`Expected exactly one Cart Transform registration; found ${state?.registrations?.length ?? 0}.`);
  }
  const [registration] = state.registrations;
  if (
    registration.id !== TARGET.registrationId
    || registration.functionId !== TARGET.functionId
    || state.allRegistrationsResolve !== true
  ) {
    throw new Error(`Cart Transform registration drifted: ${JSON.stringify(registration)}.`);
  }
}

function assertRollbackVersionsPresent(versions) {
  if (!versions.some(({ versionTag }) => versionTag === TARGET.legacyRollbackVersion)) {
    throw new Error(`The v64 rollback anchor ${TARGET.legacyRollbackVersion} is missing.`);
  }
}

function assertExactlyOneInactiveCandidate(versions) {
  const candidates = versions.filter(({ versionTag }) => (
    versionTag === TARGET.candidateVersion
  ));
  if (candidates.length !== 1 || candidates[0].status !== "inactive") {
    throw new Error(`Candidate ${TARGET.candidateVersion} is not uniquely inactive.`);
  }
  return candidates[0];
}

export function fingerprintArtifact(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error("Artifact fingerprint input must be a Buffer.");
  }
  return {
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function assertArtifactIdentity({ functionWasm, themeSource }) {
  if (
    functionWasm?.sizeBytes !== TARGET.functionWasm.sizeBytes
    || functionWasm?.sha256 !== TARGET.functionWasm.sha256
  ) {
    throw new Error(
      `Function Wasm drifted from v68: ${JSON.stringify(functionWasm)}.`,
    );
  }
  if (
    themeSource?.sizeBytes !== TARGET.themeSource.sizeBytes
    || themeSource?.sha256 !== TARGET.themeSource.sha256
  ) {
    throw new Error(
      `Theme source drifted from the approved v69 change: ${JSON.stringify(themeSource)}.`,
    );
  }
}

export function assertPreflightState(state) {
  const versions = requireVersions(state);
  if (!versionWithStatus(versions, TARGET.baselineVersion, "active")) {
    throw new Error(`Expected v68 baseline ${TARGET.baselineVersion} to be active.`);
  }
  assertRollbackVersionsPresent(versions);
  if (versions.some(({ versionTag }) => versionTag === TARGET.candidateVersion)) {
    throw new Error(`Candidate ${TARGET.candidateVersion} already exists.`);
  }
  assertStableRegistration(state);
}

export function assertInactiveCandidateState(state) {
  const versions = requireVersions(state);
  if (!versionWithStatus(versions, TARGET.baselineVersion, "active")) {
    throw new Error(`Expected v68 baseline ${TARGET.baselineVersion} to remain active.`);
  }
  assertRollbackVersionsPresent(versions);
  assertExactlyOneInactiveCandidate(versions);
  assertStableRegistration(state);
}

export function assertActiveCandidateState(state) {
  const versions = requireVersions(state);
  if (!versionWithStatus(versions, TARGET.candidateVersion, "active")) {
    throw new Error(`Expected ${TARGET.candidateVersion} to be active.`);
  }
  if (!versionWithStatus(versions, TARGET.baselineVersion, "inactive")) {
    throw new Error(`Expected v68 baseline ${TARGET.baselineVersion} to remain available and inactive.`);
  }
  assertRollbackVersionsPresent(versions);
  assertStableRegistration(state);
}

export function assertRecoveredBaselineState(state) {
  const versions = requireVersions(state);
  if (!versionWithStatus(versions, TARGET.baselineVersion, "active")) {
    throw new Error(`Expected ${TARGET.baselineVersion} to be active after recovery.`);
  }
  assertRollbackVersionsPresent(versions);
  assertStableRegistration(state);
}

export function deploymentCommands() {
  return Object.freeze({
    buildStagedApp: [
      "app", "build", "--config", TARGET.stagingAppConfig,
    ],
    readVersions: [
      "app", "versions", "list", "--config", TARGET.sourceAppConfig, "--json",
    ],
    deployInactive: [
      "app", "deploy", "--config", TARGET.stagingAppConfig,
      "--no-release",
      "--version", TARGET.candidateVersion,
      "--message", TARGET.candidateMessage,
    ],
    activateCandidate: [
      "app", "release", "--config", TARGET.stagingAppConfig,
      "--version", TARGET.candidateVersion,
      "--allow-updates",
    ],
    recoverBaseline: [
      "app", "release", "--config", TARGET.sourceAppConfig,
      "--version", TARGET.baselineVersion,
      "--allow-updates",
    ],
  });
}

export function createApprovedCandidateManifest({
  versions,
  functionWasm,
  themeSource,
}) {
  assertArtifactIdentity({ functionWasm, themeSource });
  const candidate = assertExactlyOneInactiveCandidate(versions);
  const versionId = candidate.versionId ?? candidate.id;
  if (!versionId) {
    throw new Error(`Inactive ${TARGET.candidateVersion} has no Version ID evidence.`);
  }
  return {
    schemaVersion: MANIFEST_SCHEMA,
    versionTag: TARGET.candidateVersion,
    versionId,
    functionWasm,
    themeSource,
  };
}

export function assertActivationPreflight({
  manifest,
  versions,
  functionWasm,
  themeSource,
}) {
  assertArtifactIdentity({ functionWasm, themeSource });
  const candidate = assertExactlyOneInactiveCandidate(versions);
  const versionId = candidate.versionId ?? candidate.id;
  if (
    manifest?.schemaVersion !== MANIFEST_SCHEMA
    || manifest?.versionTag !== TARGET.candidateVersion
  ) {
    throw new Error("The approved v69 candidate manifest identity is invalid.");
  }
  if (!versionId || manifest.versionId !== versionId) {
    throw new Error(
      `The inactive v69 Version ID is ${versionId}; approved ${manifest?.versionId}.`,
    );
  }
  if (
    manifest.functionWasm?.sizeBytes !== functionWasm.sizeBytes
    || manifest.functionWasm?.sha256 !== functionWasm.sha256
    || manifest.themeSource?.sizeBytes !== themeSource.sizeBytes
    || manifest.themeSource?.sha256 !== themeSource.sha256
  ) {
    throw new Error("The approved v69 manifest artifact fingerprints drifted.");
  }
  return {
    versionTag: TARGET.candidateVersion,
    versionId,
    functionWasm,
    themeSource,
  };
}

function readStateWithRetries(readState, description) {
  const errors = [];
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
    try {
      return readState();
    } catch (error) {
      errors.push(error);
    }
  }
  const error = new Error(
    `${description} failed after ${READ_ATTEMPTS} attempts.`,
    { cause: errors[0] },
  );
  error.errors = errors;
  throw error;
}

export function executeInactiveDeploymentBoundary({ deployInactive, readState }) {
  deployInactive();
  const state = readStateWithRetries(readState, "Post-deployment state read");
  assertInactiveCandidateState(state);
  return state;
}

export function executeBaselineRecovery({ recoverBaseline, readState }) {
  recoverBaseline();
  const state = readStateWithRetries(readState, "Post-recovery state read");
  assertRecoveredBaselineState(state);
  return state;
}

export function executeActivationBoundary({
  activateCandidate,
  recoverBaseline,
  readState,
}) {
  try {
    activateCandidate();
    const state = readStateWithRetries(readState, "Post-activation state read");
    assertActiveCandidateState(state);
    return state;
  } catch (activationError) {
    try {
      executeBaselineRecovery({ recoverBaseline, readState });
    } catch (recoveryError) {
      const error = new Error(
        `v69 activation failed and ${TARGET.baselineVersion} recovery could not be verified.`,
        { cause: activationError },
      );
      error.errors = [activationError, recoveryError];
      throw error;
    }
    throw activationError;
  }
}
