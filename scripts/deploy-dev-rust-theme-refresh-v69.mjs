import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import {
  TARGET,
  assertActivationPreflight,
  assertArtifactIdentity,
  assertPreflightState,
  createApprovedCandidateManifest,
  deploymentCommands,
  executeActivationBoundary,
  executeBaselineRecovery,
  executeInactiveDeploymentBoundary,
  fingerprintArtifact,
} from "./rust-theme-refresh-v69-release.js";
import {
  assertStagedAppInfo,
  resolveStagingPaths,
} from "./rust-projection-dev-integration.js";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "node_modules/@shopify/cli/bin/run.js");
const stagingPaths = resolveStagingPaths(root);
const manifestPath = resolve(
  root,
  ".local",
  "rust-theme-refresh-v69-approved-candidate.json",
);
const themeSourcePath = resolve(
  root,
  "extensions/product-builder/blocks/prebuilt-bundle-product-form.liquid",
);
const modes = new Map([
  [undefined, "dry-run"],
  ["--deploy-inactive", "deploy-inactive"],
  ["--activate-candidate", "activate-candidate"],
  ["--recover-v68", "recover-v68"],
]);
const requested = process.argv.slice(2);
if (requested.length > 1 || !modes.has(requested[0])) {
  throw new Error(
    "Usage: deploy-dev-rust-theme-refresh-v69.mjs "
    + "[--deploy-inactive|--activate-candidate|--recover-v68]",
  );
}
const mode = modes.get(requested[0]);
const commands = deploymentCommands();

if (mode === "dry-run" || mode === "deploy-inactive") {
  prepareCandidate();
  const artifacts = readArtifacts();
  assertArtifactIdentity(artifacts);
  const stateBefore = readState();
  assertPreflightState(stateBefore);
  console.log(JSON.stringify({
    mode,
    target: TARGET,
    artifacts,
    activeBefore: activeVersion(stateBefore),
    registrationBefore: stateBefore.registrations[0],
    command: commands.deployInactive,
    externalWritesPlanned: mode === "deploy-inactive",
  }, null, 2));

  if (mode === "dry-run") process.exit(0);

  const deployed = executeInactiveDeploymentBoundary({
    deployInactive: () => runCli(commands.deployInactive, true),
    readState,
  });
  const approvedCandidate = createApprovedCandidateManifest({
    versions: deployed.versions,
    ...artifacts,
  });
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(approvedCandidate, null, 2)}\n`);
  console.log(JSON.stringify({
    mode,
    activeAfter: activeVersion(deployed),
    candidate: deployed.versions.find(({ versionTag }) => (
      versionTag === TARGET.candidateVersion
    )),
    approvedCandidate,
    approvedCandidateManifest: manifestPath,
    registrationAfter: deployed.registrations[0],
    allRegistrationsResolve: deployed.allRegistrationsResolve,
    recoveryRequired: false,
  }, null, 2));
}

if (mode === "activate-candidate") {
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing inactive candidate manifest ${manifestPath}.`);
  }
  validateStagedApp();
  const artifacts = readArtifacts();
  const stateBefore = readState();
  const approvedActivation = assertActivationPreflight({
    manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
    versions: stateBefore.versions,
    ...artifacts,
  });
  console.log(JSON.stringify({
    mode,
    target: TARGET,
    approvedActivation,
    activeBefore: activeVersion(stateBefore),
    registrationBefore: stateBefore.registrations[0],
    command: commands.activateCandidate,
    automaticFailureRecovery: commands.recoverBaseline,
    externalWritesPlanned: true,
  }, null, 2));
  const activated = executeActivationBoundary({
    activateCandidate: () => runCli(commands.activateCandidate, true),
    recoverBaseline: () => runCli(commands.recoverBaseline, true),
    readState,
  });
  console.log(JSON.stringify({
    mode,
    activeAfter: activeVersion(activated),
    registrationAfter: activated.registrations[0],
    allRegistrationsResolve: activated.allRegistrationsResolve,
    recoveryRequired: true,
    requiredRecoveryCommand: commands.recoverBaseline,
  }, null, 2));
}

if (mode === "recover-v68") {
  const recovered = executeBaselineRecovery({
    recoverBaseline: () => runCli(commands.recoverBaseline, true),
    readState,
  });
  console.log(JSON.stringify({
    mode,
    activeAfter: activeVersion(recovered),
    registrationAfter: recovered.registrations[0],
    allRegistrationsResolve: recovered.allRegistrationsResolve,
    recoveryRequired: false,
  }, null, 2));
}

function prepareCandidate() {
  runNode(["scripts/stage-rust-projection-dev-integration.mjs"]);
  runNode([
    "node_modules/vitest/vitest.mjs",
    "run",
    "scripts/rust-theme-refresh-v69-release.test.js",
    "scripts/rust-projection-dev-integration.test.js",
    "tests/prebuilt-bundle-product-form.test.js",
  ]);
  runRustTests();
  runNode(["scripts/check-prebuilt-projection-rust-spike.mjs"]);
  runNode(["scripts/assert-production-function-clean.mjs"]);
  const buildInvocationId = randomUUID();
  runCli(commands.buildStagedApp, true, {
    ...process.env,
    ACES_RUST_BUILD_INVOCATION_ID: buildInvocationId,
  });
  const provenance = JSON.parse(readFileSync(
    `${stagingPaths.wasm}.provenance.json`,
    "utf8",
  ));
  if (provenance.invocationId !== buildInvocationId) {
    throw new Error("The staged Rust Wasm build provenance is stale.");
  }
  validateStagedApp();
}

function validateStagedApp() {
  const validation = runCliJson([
    "app", "config", "validate", "--config", TARGET.stagingAppConfig, "--json",
  ]);
  if (validation.valid !== true || validation.issues?.length) {
    throw new Error(`Staged app config is invalid: ${JSON.stringify(validation)}.`);
  }
  const info = runCliJson([
    "app", "info", "--config", TARGET.stagingAppConfig, "--json",
  ]);
  assertStagedAppInfo(info);
}

function readArtifacts() {
  return {
    functionWasm: fingerprintArtifact(readFileSync(stagingPaths.wasm)),
    themeSource: fingerprintArtifact(readFileSync(themeSourcePath)),
  };
}

function readState() {
  return {
    ...runNodeJson(["scripts/diagnose-cart-transform.mjs"]),
    versions: runCliJson(commands.readVersions),
  };
}

function activeVersion(state) {
  return state.versions.find(({ status }) => status === "active");
}

function runRustTests() {
  runCommand("cargo", [
    "test",
    "--locked",
    "--manifest-path",
    "extensions/master-kit-expand-rust-spike/Cargo.toml",
  ], { environment: msvcEnvironment(), inherit: true });
}

function runNode(args) {
  runCommand(process.execPath, args, { inherit: true });
}

function runNodeJson(args) {
  return JSON.parse(runCommand(process.execPath, args).stdout);
}

function runCli(args, inherit = false, environment = process.env) {
  return runCommand(
    process.execPath,
    [cli, ...args],
    { inherit, environment },
  );
}

function runCliJson(args) {
  return JSON.parse(runCli(args).stdout);
}

function runCommand(command, args, {
  environment = process.env,
  inherit = false,
} = {}) {
  const execution = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: environment,
    maxBuffer: 30 * 1024 * 1024,
    stdio: inherit ? "inherit" : "pipe",
    windowsHide: true,
  });
  if (execution.status !== 0) {
    throw new Error(
      execution.stderr?.trim()
      || execution.stdout?.trim()
      || `Command failed: ${command} ${args.join(" ")}`,
    );
  }
  return execution;
}

function msvcEnvironment() {
  if (process.platform !== "win32") return process.env;
  const vswhere = resolve(
    process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)",
    "Microsoft Visual Studio/Installer/vswhere.exe",
  );
  const discovery = spawnSync(vswhere, [
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property",
    "installationPath",
  ], { encoding: "utf8", windowsHide: true });
  if (discovery.status !== 0 || !discovery.stdout.trim()) {
    throw new Error("Visual C++ Build Tools were not found.");
  }
  const vcvars = resolve(discovery.stdout.trim(), "VC/Auxiliary/Build/vcvars64.bat");
  const environment = spawnSync("cmd.exe", [
    "/d",
    "/c",
    `""${vcvars}" >nul && set"`,
  ], { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true });
  if (environment.status !== 0) {
    throw new Error("Failed to load vcvars64.bat.");
  }
  return environment.stdout.split(/\r?\n/).reduce((values, line) => {
    const separator = line.indexOf("=");
    if (separator > 0) {
      values[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return values;
  }, { ...process.env });
}
