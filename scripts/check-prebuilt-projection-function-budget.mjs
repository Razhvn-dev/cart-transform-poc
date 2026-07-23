import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { buildPrebuiltBundleProjectionFunctionCandidate } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-projection.function-candidate.js";
import { buildProjectionBenchmarkCases } from "./prebuilt-projection-benchmark-fixtures.mjs";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "node_modules/@shopify/cli/bin/run.js");
const extension = resolve(root, "extensions/master-kit-expand");
const instructionLimit = 11_000_000;
const requestedCases = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["8", "real-10", "12"];
const benchmarkCases = buildProjectionBenchmarkCases(requestedCases);

try {
  runNode(["scripts/build-function.mjs", "--retain-profile-artifact-for-deployment"], {
    ACES_FUNCTION_DEPLOY_BUILD: "1",
    FUNCTION_PROFILE: "prebuilt-projection-candidate",
    SHOPIFY_APP_CONFIG: "shopify.app.dev.toml",
  });

  const results = benchmarkCases.map(runBenchmark);
  console.log(JSON.stringify({ instruction_limit: instructionLimit, results }, null, 2));
  if (results.some(({ status }) => status !== "pass")) process.exitCode = 1;
} finally {
  runNode(["scripts/build-function.mjs", "--profile", "production"]);
  runNode(["scripts/assert-production-function-clean.mjs"]);
}

function runBenchmark({ label, componentCount, input }) {
  const localCandidate = buildPrebuiltBundleProjectionFunctionCandidate(input);
  if (localCandidate.status !== "ready") {
    throw new Error(`Synthetic ${componentCount}-component projection is invalid: ${JSON.stringify(localCandidate)}`);
  }
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
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  if (execution.status !== 0) {
    throw new Error(execution.stderr.trim() || execution.stdout.trim() || "Function benchmark failed");
  }
  const result = JSON.parse(execution.stdout);
  const instructions = Number(result.instructions);
  if (!Number.isSafeInteger(instructions)) {
    throw new Error(`Function benchmark did not report an instruction cost: ${JSON.stringify(result)}`);
  }
  const operations = result.output?.operations ?? [];
  return {
    fixture: label,
    component_count: componentCount,
    instructions,
    headroom: instructionLimit - instructions,
    operation_count: operations.length,
    expanded_item_count: operations[0]?.expand?.expandedCartItems?.length ?? 0,
    status: instructions <= instructionLimit && operations.length === 1 ? "pass" : "fail",
  };
}

function runNode(args, extraEnv = {}) {
  const execution = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  if (execution.status !== 0) {
    throw new Error(execution.stderr.trim() || execution.stdout.trim() || `Command failed: node ${args.join(" ")}`);
  }
}
