import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertProfileAppConfigAllowed,
  repoRoot,
  restoreProductionFunctionProfile,
  stageFunctionProfileForDeployment,
} from "./function-profile.mjs";

const profile = process.argv[2];
const appConfigIndex = process.argv.indexOf("--app-config");
const messageIndex = process.argv.indexOf("--message");
const appConfig = appConfigIndex >= 0 ? process.argv[appConfigIndex + 1] : null;
const message = messageIndex >= 0 ? process.argv[messageIndex + 1] : null;

if (!profile || !appConfig || !message) {
  throw new Error(
    "Usage: node scripts/deploy-function-profile.mjs <profile> --app-config <file> --message <message>",
  );
}

assertProfileAppConfigAllowed(profile, appConfig);

const node = process.execPath;
const buildScript = resolve(repoRoot, "scripts/build-function.mjs");
const cli = resolve(repoRoot, "node_modules/@shopify/cli/bin/run.js");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
  });
}

try {
  // Retain the selected dev Wasm only inside this guarded deployment window.
  // The build restores the active query, so re-stage it for --no-build packaging;
  // the outer finally always rebuilds the production query/types/artifacts.
  run(node, [
    buildScript,
    "--profile",
    profile,
    "--app-config",
    appConfig,
    "--retain-profile-artifact-for-deployment",
  ], { env: { ACES_FUNCTION_DEPLOY_BUILD: "1" } });
  const selected = stageFunctionProfileForDeployment(profile, { appConfig });
  console.log(`Deploying ${profile} Function profile (${selected.query}) with ${appConfig}.`);
  run(node, [
    cli,
    "app",
    "deploy",
    "--config",
    appConfig,
    "--no-build",
    "--allow-updates",
    "--message",
    message,
  ]);
} finally {
  // Never leave a dev input query or generated artifact in the local tree.
  restoreProductionFunctionProfile();
  run(node, [buildScript, "--profile", "production"]);
}
