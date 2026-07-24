import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { isPathInside } from "./path-boundary.js";

const root = resolve(import.meta.dirname, "..");
const crate = resolve(root, "extensions/master-kit-expand-rust-spike/Cargo.toml");
const sourceWasm = resolve(
  root,
  "extensions/master-kit-expand-rust-spike/target/wasm32-unknown-unknown/release/master-kit-expand-rust-spike.wasm",
);
const outputIndex = process.argv.indexOf("--output");
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;

if (!output) throw new Error("Usage: build-rust-projection-function.mjs --output <wasm-path>");
const outputWasm = resolve(process.cwd(), output);
const stagingRoot = resolve(root, ".local/rust-projection-dev-integration");
if (!isPathInside({ root: stagingRoot, candidate: outputWasm })) {
  throw new Error(`Rust deployment output must stay inside ${stagingRoot}; received ${outputWasm}.`);
}

const execution = spawnSync("cargo", [
  "build",
  "--locked",
  "--manifest-path",
  crate,
  "--target",
  "wasm32-unknown-unknown",
  "--release",
], {
  cwd: root,
  encoding: "utf8",
  env: msvcEnvironment(),
  maxBuffer: 20 * 1024 * 1024,
  windowsHide: true,
});
if (execution.status !== 0) throw commandError(execution, "Rust release build failed");

mkdirSync(dirname(outputWasm), { recursive: true });
copyFileSync(sourceWasm, outputWasm);
const fingerprint = (path) => {
  const content = readFileSync(path);
  return {
    sizeBytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
};
const buildProvenance = {
  schemaVersion: "rust_projection_build_provenance.v1",
  invocationId: process.env.ACES_RUST_BUILD_INVOCATION_ID || null,
  sourceWasm: fingerprint(sourceWasm),
  copiedWasm: fingerprint(outputWasm),
};
writeFileSync(
  `${outputWasm}.provenance.json`,
  `${JSON.stringify(buildProvenance, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ sourceWasm, outputWasm, buildProvenance }, null, 2));

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
    throw commandError(discovery, "Visual C++ Build Tools were not found");
  }
  const vcvars = resolve(discovery.stdout.trim(), "VC/Auxiliary/Build/vcvars64.bat");
  const environment = spawnSync("cmd.exe", [
    "/d",
    "/c",
    `""${vcvars}" >nul && set"`,
  ], { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true });
  if (environment.status !== 0) throw commandError(environment, "Failed to load vcvars64.bat");
  return environment.stdout.split(/\r?\n/).reduce((values, line) => {
    const separator = line.indexOf("=");
    if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1);
    return values;
  }, { ...process.env });
}

function commandError(execution, fallback) {
  return new Error(execution.stderr?.trim() || execution.stdout?.trim() || fallback);
}
