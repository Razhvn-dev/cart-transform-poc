import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertApprovedV67ActivationPreflight,
  fingerprintWasmArtifact,
} from "./rust-projection-v67-activation-preflight.js";
import {
  TARGET,
  assertDeployableCandidateVersion,
  assertInactiveCandidateState,
  assertPreflightState,
  assertStagedAppInfo,
  deploymentCommands,
  executeActivationBoundary,
  executeBaselineRecovery,
  executeInactiveDeploymentBoundary,
  executeModeSetup,
  executionMode,
  inspectStagedWasmArtifact,
  resolveStagingPaths,
} from "./rust-projection-dev-integration.js";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "node_modules/@shopify/cli/bin/run.js");
const mode = executionMode(process.argv.slice(2));
if (mode !== "recover-v64") {
  assertDeployableCandidateVersion(TARGET.candidateVersion);
}
const commands = deploymentCommands();
const stagingPaths = resolveStagingPaths(root);

executeModeSetup({
  mode,
  prepareCandidate: () => {
    runNode(["scripts/stage-rust-projection-dev-integration.mjs"]);
    if (mode === "dry-run" || mode === "deploy-inactive") {
      runNode(["node_modules/vitest/vitest.mjs", "run", "scripts/rust-projection-dev-integration.test.js"]);
      runRustTests();
      runNode(["scripts/check-prebuilt-projection-rust-spike.mjs"]);
      runNode(["scripts/assert-production-function-clean.mjs"]);
      runCli(commands.buildStagedApp, true);
    }
    const configValidation = runCliJson([
      "app", "config", "validate", "--config", TARGET.appConfig, "--json",
    ]);
    if (configValidation.valid !== true || configValidation.issues?.length) {
      throw new Error(`Staged app config is invalid: ${JSON.stringify(configValidation)}.`);
    }
    const appInfo = runCliJson(["app", "info", "--config", TARGET.appConfig, "--json"]);
    assertStagedAppInfo(appInfo);
  },
});

if (mode === "dry-run" || mode === "deploy-inactive") {
  const artifact = inspectStagedWasmArtifact({
    sourceWasm: readFileSync(resolve(
      root,
      "extensions/master-kit-expand-rust-spike/target/wasm32-unknown-unknown/release/master-kit-expand-rust-spike.wasm",
    )),
    stagedWasm: readFileSync(stagingPaths.wasm),
  });
  const stateBefore = readState();
  assertPreflightState(stateBefore);

  console.log(JSON.stringify({
    mode,
    target: TARGET,
    stagedWasm: artifact,
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
  console.log(JSON.stringify({
    mode: "deploy-inactive",
    activeAfter: activeVersion(deployed),
    candidate: deployed.versions.find(({ versionTag }) => (
      versionTag === TARGET.candidateVersion
    )),
    registrationAfter: deployed.registrations[0],
    allRegistrationsResolve: deployed.allRegistrationsResolve,
    recoveryRequired: false,
  }, null, 2));
}

if (mode === "activate-candidate") {
  const stateBefore = readState();
  assertInactiveCandidateState(stateBefore);
  const approvedCandidate = JSON.parse(readFileSync(
    resolve(root, "scripts/rust-projection-v67-approved-candidate.json"),
    "utf8",
  ));
  const approvedActivation = assertApprovedV67ActivationPreflight({
    approvedCandidate,
    versions: stateBefore.versions,
    stagedWasmFingerprint: fingerprintWasmArtifact(readFileSync(stagingPaths.wasm)),
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
    readState,
    recoverBaseline: () => runCli(commands.recoverBaseline, true),
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

if (mode === "recover-v64") {
  const recovered = executeBaselineRecovery({
    recoverBaseline: () => runCli(commands.recoverBaseline, true),
    readState,
  });
  console.log(JSON.stringify({
    mode,
    activeAfter: activeVersion(recovered),
    registrationAfter: recovered.registrations[0],
    allRegistrationsResolve: recovered.allRegistrationsResolve,
    recoveryExecuted: recovered.recoveryExecuted,
    recoveryRequired: false,
  }, null, 2));
}

function readVersions() {
  return runCliJson(commands.readVersions);
}

function readBinding() {
  return runNodeJson(["scripts/diagnose-cart-transform.mjs"]);
}

function readState() {
  const versions = readVersions();
  const binding = readBinding();
  return { ...binding, versions };
}

function activeVersion(state) {
  return state.versions.find(({ status }) => status === "active");
}

function runRustTests() {
  const environment = msvcEnvironment();
  runCommand("cargo", [
    "test",
    "--locked",
    "--manifest-path",
    "extensions/master-kit-expand-rust-spike/Cargo.toml",
  ], { environment, inherit: true });
}

function runNode(args) {
  runCommand(process.execPath, args, { inherit: true });
}

function runNodeJson(args) {
  return JSON.parse(runCommand(process.execPath, args).stdout);
}

function runCli(args, inherit = false) {
  return runCommand(process.execPath, [cli, ...args], { inherit });
}

function runCliJson(args) {
  return JSON.parse(runCli(args).stdout);
}

function runCommand(command, args, { environment = process.env, inherit = false } = {}) {
  const execution = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: environment,
    maxBuffer: 30 * 1024 * 1024,
    stdio: inherit ? "inherit" : "pipe",
    windowsHide: true,
  });
  if (execution.status !== 0) {
    throw new Error(execution.stderr?.trim() || execution.stdout?.trim()
      || `Command failed: ${command} ${args.join(" ")}`);
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
  if (environment.status !== 0) throw new Error("Failed to load vcvars64.bat.");
  return environment.stdout.split(/\r?\n/).reduce((values, line) => {
    const separator = line.indexOf("=");
    if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1);
    return values;
  }, { ...process.env });
}
