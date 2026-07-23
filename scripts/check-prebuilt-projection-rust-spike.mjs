import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { run as runProductionSharedCore } from "../extensions/master-kit-expand/src/run.core.js";

import {
  PROJECTION_BENCHMARK_GOLDEN_VERSION,
  assertProjectionBenchmarkGoldenFreshness,
  buildProjectionBenchmarkCases,
  buildProjectionMultiLineEnvelopeCases,
  parseHybridSharedCoreGoldenOracle,
} from "./prebuilt-projection-benchmark-fixtures.mjs";
import {
  classifyConservativeInstructionBudget,
  classifyInstructionBudget,
  compareFunctionOutputs,
  evaluateRustSpikeReleaseGate,
} from "./prebuilt-projection-rust-spike-result.js";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "node_modules/@shopify/cli/bin/run.js");
const javascriptExtension = resolve(root, "extensions/master-kit-expand");
const rustExtension = resolve(root, "extensions/master-kit-expand-rust-spike");
const hybridOraclePath = resolve(
  rustExtension,
  "tests/fixtures/shared-core-parity.v1.json",
);
const strictProbeMode = process.argv.slice(2).includes("--strict-probes");
const benchmarkCases = buildProjectionBenchmarkCases();
const envelopeCases = buildProjectionMultiLineEnvelopeCases();

try {
  const freshness = assertProjectionBenchmarkGoldenFreshness(benchmarkCases);
  runNode(["scripts/build-function.mjs", "--retain-profile-artifact-for-deployment"], {
    ACES_FUNCTION_DEPLOY_BUILD: "1",
    FUNCTION_PROFILE: "prebuilt-projection-candidate",
    SHOPIFY_APP_CONFIG: "shopify.app.dev.toml",
  });
  runCli(["app", "function", "build", "--path", rustExtension], msvcEnvironment());

  const results = benchmarkCases.map((benchmark) => {
    const javascript = runFunction(javascriptExtension, benchmark.input);
    const rust = runFunction(rustExtension, benchmark.input);
    compareFunctionOutputs(
      benchmark.expectedOutput,
      javascript.output,
      `${benchmark.label} JavaScript golden`,
    );
    compareFunctionOutputs(
      benchmark.expectedOutput,
      rust.output,
      `${benchmark.label} Rust golden`,
    );
    return {
      fixture: benchmark.label,
      component_count: benchmark.componentCount,
      golden_parity: "pass",
      javascript: classifyInstructionBudget(javascript.instructions),
      rust: classifyConservativeInstructionBudget(rust.instructions),
    };
  });

  const hybridOracle = runHybridSharedCoreGoldenOracle();

  const cartEnvelopes = envelopeCases.map((benchmark) => {
    const rust = runFunction(rustExtension, benchmark.input);
    compareFunctionOutputs(
      benchmark.expectedOutput,
      rust.output,
      `${benchmark.label} Rust golden`,
    );
    return {
      fixture: benchmark.label,
      cart_line_count: benchmark.lineCount,
      component_count_per_line: benchmark.componentCount,
      cart_total_expanded_items: benchmark.expandedItemCount,
      support: benchmark.support,
      expectedBudgetStatus: benchmark.expectedBudgetStatus,
      golden_parity: "pass",
      rust: classifyInstructionBudget(rust.instructions),
      conservative_gate: classifyConservativeInstructionBudget(rust.instructions),
    };
  });

  const gate = evaluateRustSpikeReleaseGate({
    supported: [
      ...results,
      ...(hybridOracle.results ?? []),
    ],
    boundaryProbes: cartEnvelopes,
    strictProbes: strictProbeMode,
  });
  const riskBoundaries = gate.boundaryProbes
    .filter(({ rust }) => rust.status === "risk-review")
    .map(({ fixture }) => fixture);
  const hardBoundaries = gate.boundaryProbes
    .filter(({ rust }) => rust.status === "fail")
    .map(({ fixture }) => fixture);

  console.log(JSON.stringify({
    golden_oracle: {
      version: PROJECTION_BENCHMARK_GOLDEN_VERSION,
      freshness: "pass",
      case_count: freshness.caseCount,
    },
    instruction_limit: 11_000_000,
    engineering_target: 8_800_000,
    minimum_headroom_ratio: 0.2,
    supported_envelope: {
      cart_line_count: 1,
      component_count_per_line: 19,
      basis_fixture: "worst-string-19",
      gate: "minimum 20 percent instruction headroom",
    },
    release_preflight: {
      status: gate.releaseStatus,
      strict_probe_mode: strictProbeMode,
      strict_probe_status: gate.strictProbeStatus,
    },
    hybrid_shared_core_oracle: hybridOracle,
    supported_results: results,
    boundary_report: {
      status: gate.boundaryProbes.every(({ boundaryStatus }) => (
        boundaryStatus === "expected_boundary"
      )) ? "expected_boundary" : "unexpected_boundary",
      risk_review: riskBoundaries,
      hard_limit: hardBoundaries,
      probes: gate.boundaryProbes,
    },
  }, null, 2));
  if (gate.shouldFail) process.exitCode = 1;
} finally {
  runNode(["scripts/build-function.mjs", "--profile", "production"]);
  runNode(["scripts/assert-production-function-clean.mjs"]);
}

function runHybridSharedCoreGoldenOracle() {
  if (!existsSync(hybridOraclePath)) {
    return {
      schema_version: "shared_core_parity.v1",
      status: "pending_fixture",
      path: hybridOraclePath,
      results: [],
    };
  }
  const oracle = parseHybridSharedCoreGoldenOracle(
    JSON.parse(readFileSync(hybridOraclePath, "utf8")),
  );
  const results = oracle.cases.map((benchmark) => {
    const input = buildHybridSharedCoreInput(benchmark);
    const expectedOutput = runProductionSharedCore(input);
    const javascript = runFunction(javascriptExtension, input);
    const rust = runFunction(rustExtension, input);
    compareFunctionOutputs(
      expectedOutput,
      javascript.output,
      `${benchmark.label} JavaScript golden`,
    );
    compareFunctionOutputs(
      expectedOutput,
      rust.output,
      `${benchmark.label} Rust golden`,
    );
    return {
      fixture: benchmark.label,
      golden_parity: "pass",
      javascript: classifyInstructionBudget(javascript.instructions),
      rust: classifyConservativeInstructionBudget(rust.instructions),
    };
  });
  return {
    schema_version: oracle.schemaVersion,
    status: "pass",
    path: hybridOraclePath,
    case_count: results.length,
    results,
  };
}

function buildHybridSharedCoreInput(benchmark) {
  const input = structuredClone(buildProjectionBenchmarkCases(["8"])[0].input);
  const line = input.cart.lines[0];
  line.id = `gid://shopify/CartLine/parity-${benchmark.name}`;
  line.merchandise.id = "gid://shopify/ProductVariant/51505325605142";
  line.merchandise.product.id = "gid://shopify/Product/10600519598358";
  delete line.merchandise.product.prebuiltExpandProjectionMetafield;
  line.parentProductGid = { value: "gid://shopify/Product/10600519598358" };
  line.parentVariantGid = { value: "gid://shopify/ProductVariant/51505325605142" };
  line.builderEfiVariantId = { value: benchmark.efi };
  line.builderFuelVariantId = { value: benchmark.fuel };
  line.builderIgnitionVariantId = { value: benchmark.ignition };
  line.builderDisplayVariantId = benchmark.display == null
    ? null
    : { value: benchmark.display };
  if (benchmark.metadata === "legacy") line.bundleId = null;
  return input;
}

function runFunction(extension, input) {
  const execution = spawnSync(process.execPath, [
    cli,
    "app",
    "function",
    "run",
    "--path",
    extension,
    "--json",
  ], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify(input),
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  if (execution.status !== 0) throw commandError(execution, "Function run failed");
  const result = JSON.parse(execution.stdout);
  if (!Number.isSafeInteger(Number(result.instructions))) {
    throw new Error(`Function run did not report an instruction count: ${execution.stdout}`);
  }
  return { output: result.output, instructions: Number(result.instructions) };
}

function runNode(args, extraEnv = {}) {
  const execution = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  if (execution.status !== 0) throw commandError(execution, `Command failed: node ${args.join(" ")}`);
}

function runCli(args, environment = process.env) {
  const execution = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: environment,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  if (execution.status !== 0) throw commandError(execution, `Shopify CLI failed: ${args.join(" ")}`);
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
