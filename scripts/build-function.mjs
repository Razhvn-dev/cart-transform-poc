import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  assertProductionCleanArtifacts,
  assertPrebuiltObserveGeneratedInputType,
  assertPrebuiltProjectionGeneratedInputType,
  assertProfileAppConfigAllowed,
  assertStage2CleanArtifacts,
  assertStage3GeneratedInputType,
  extDir,
  resolveProfile,
  restoreProductionFunctionProfile,
  withTemporaryFunctionProfile,
} from "./function-profile.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliBin = resolve(__dirname, "../node_modules/@shopify/cli/bin");
const javyVersion = "9.0.0";
const javyPluginVersion = "4";

const javyExe = join(cliBin, `javy-${javyVersion}.exe`);
const javyPlugin = join(cliBin, `shopify_functions_javy_v${javyPluginVersion}.wasm`);
const distDir = join(extDir, "dist");
const functionJs = join(distDir, "function.js");
const functionWasm = join(distDir, "index.wasm");
const witFile = join(distDir, "javy-world.wit");
const entryArgIndex = process.argv.indexOf("--entry");
const profileArgIndex = process.argv.indexOf("--profile");
const appConfigArgIndex = process.argv.indexOf("--app-config");
const retainProfileArtifactForDeployment = process.argv.includes("--retain-profile-artifact-for-deployment");
const functionProfile =
  profileArgIndex >= 0
    ? process.argv[profileArgIndex + 1]
    : process.env.FUNCTION_PROFILE || "production";
const appConfig =
  appConfigArgIndex >= 0
    ? process.argv[appConfigArgIndex + 1]
    : process.env.SHOPIFY_APP_CONFIG || null;
const selectedProfile = resolveProfile(functionProfile);
const entryPath =
  entryArgIndex >= 0
    ? process.argv[entryArgIndex + 1]
    : selectedProfile.entry;
const expectedEntryPath = selectedProfile.entry;

if (entryPath !== expectedEntryPath) {
  throw new Error(
    `Function profile "${functionProfile}" must use ${expectedEntryPath}; received ${entryPath}.`,
  );
}
assertProfileAppConfigAllowed(functionProfile, appConfig);
if (retainProfileArtifactForDeployment) {
  if (functionProfile === "production") {
    throw new Error("Production builds cannot retain a development deployment artifact.");
  }
  if (process.env.ACES_FUNCTION_DEPLOY_BUILD !== "1") {
    throw new Error(
      "--retain-profile-artifact-for-deployment is reserved for deploy-function-profile.mjs.",
    );
  }
}

function run(cmd, cwd = extDir) {
  execSync(cmd, { stdio: "inherit", cwd });
}

async function ensureJavy() {
  if (!existsSync(javyExe)) {
    console.log("Downloading javy...");
    const javyUrl = `https://github.com/bytecodealliance/javy/releases/download/v${javyVersion}/javy-x86_64-windows-v${javyVersion}.gz`;
    const response = await fetch(javyUrl);
    if (!response.ok) throw new Error(`Failed to download javy: ${javyUrl}`);
    writeFileSync(javyExe, gunzipSync(Buffer.from(await response.arrayBuffer())));
  }

  if (!existsSync(javyPlugin)) {
    console.log("Downloading Shopify javy plugin...");
    const pluginUrl = `https://cdn.shopify.com/shopifycloud/shopify-functions-javy-plugin/shopify_functions_javy_v${javyPluginVersion}.wasm`;
    const response = await fetch(pluginUrl);
    if (!response.ok) throw new Error(`Failed to download plugin: ${pluginUrl}`);
    writeFileSync(javyPlugin, Buffer.from(await response.arrayBuffer()));
  }
}

function buildEntrySource(entry = entryPath) {
  return `
import __runFunction from "@shopify/shopify_function/run";
import { run as run_run } from "./${entry}";

export function run() {
  return __runFunction(run_run);
}
`.trim();
}

async function bundleFunction(entry = entryPath) {
  mkdirSync(distDir, { recursive: true });
  run("npx graphql-code-generator --config package.json");

  const require = createRequire(import.meta.url);
  let esbuild;
  try {
    esbuild = require("esbuild");
  } catch {
    esbuild = require(
      resolve(__dirname, "../node_modules/@shopify/cli/node_modules/esbuild"),
    );
  }

  await esbuild.build({
    stdin: {
      contents: buildEntrySource(entry),
      loader: "ts",
      resolveDir: extDir,
    },
    outfile: functionJs,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2020",
    alias: {
      "@shopify/shopify_function/run": resolve(
        __dirname,
        "../node_modules/@shopify/shopify_function/run.ts",
      ),
    },
  });
}

function assertPrebuiltCandidateBundleIsRuntimeSafe() {
  const source = readFileSync(functionJs, "utf8");

  for (const token of ["structuredClone("]) {
    if (source.includes(token)) {
      throw new Error(`Pre-built candidate bundle contains unsupported runtime call "${token}"`);
    }
  }

  for (const token of [
    "prebuiltRuntimeMappingMetafield",
    "prebuiltRuntimeSnapshotMetafield",
    "SNAPSHOT_PARENT_PRODUCT_MISMATCH",
  ]) {
    if (!source.includes(token)) {
      throw new Error(`Pre-built candidate bundle is missing required runtime token "${token}"`);
    }
  }
}

function assertPrebuiltProjectionBundleIsRuntimeSafe() {
  const source = readFileSync(functionJs, "utf8");
  for (const token of ["structuredClone(", "prebuiltRuntimeSnapshotMetafield", "prebuiltRuntimeMappingMetafield"]) {
    if (source.includes(token)) throw new Error(`Pre-built projection bundle contains forbidden runtime token "${token}"`);
  }
  for (const token of ["prebuiltExpandProjectionMetafield", "prebuilt_bundle_expand_projection.v1"]) {
    if (!source.includes(token)) throw new Error(`Pre-built projection bundle is missing required runtime token "${token}"`);
  }
}

function compileWasm() {
  writeFileSync(
    witFile,
    `package function:impl;

world shopify-function {
  export %run: func();
}
`,
    "utf8",
  );

  const args = [
    "build",
    "-C",
    "dynamic",
    "-C",
    `plugin=${javyPlugin}`,
    "-C",
    `wit=${witFile}`,
    "-C",
    "wit-world=shopify-function",
    "-o",
    functionWasm,
    "dist/function.js",
  ];

  execSync(`"${javyExe}" ${args.map((a) => `"${a}"`).join(" ")}`, {
    cwd: extDir,
    stdio: "inherit",
  });
}

try {
  await withTemporaryFunctionProfile(functionProfile, { appConfig }, async (selected) => {
    console.log(`Using ${functionProfile} Function profile (${selected.query}, ${entryPath})`);
    await ensureJavy();
    await bundleFunction();
    if ([
      "prebuilt-candidate",
      "prebuilt-candidate-static-fallback",
      "prebuilt-candidate-build-static-probe",
      "prebuilt-candidate-import-static-probe",
      "prebuilt-metadata-lookup-static-probe",
    ].includes(functionProfile)) {
      assertPrebuiltCandidateBundleIsRuntimeSafe();
    }
    if ([
      "prebuilt-projection-candidate",
      "prebuilt-projection-static-fallback",
      "prebuilt-projection-diagnostic-static-probe",
      "prebuilt-projection-promotion-bypass-bisect",
    ].includes(functionProfile)) {
      assertPrebuiltProjectionBundleIsRuntimeSafe();
      assertPrebuiltProjectionGeneratedInputType();
    }
    if (
      functionProfile === "bisect-stage-3" ||
      functionProfile === "bisect-stage-4" ||
      functionProfile === "bisect-stage-5" ||
      functionProfile === "bisect-stage-6" ||
      functionProfile === "bisect-stage-7" ||
      functionProfile === "bisect-stage-8"
    ) {
      assertStage3GeneratedInputType();
    }
    if ([
      "prebuilt-observe",
      "prebuilt-resolve-observe",
      "prebuilt-candidate",
      "prebuilt-candidate-static-fallback",
      "prebuilt-candidate-build-static-probe",
      "prebuilt-candidate-import-static-probe",
      "prebuilt-metadata-lookup-static-probe",
    ].includes(functionProfile)) {
      assertPrebuiltObserveGeneratedInputType();
    }
    compileWasm();
    console.log(`Built ${functionWasm}`);
  });
} finally {
  if (functionProfile !== "production" && !retainProfileArtifactForDeployment) {
    restoreProductionFunctionProfile();
    // Dev profiles need a dev query and generated types while packaging, but their
    // JavaScript/Wasm artifact must never remain in dist after the local build.
    // Rebuild the production artifact after restoring the production query so a
    // later validation or release cannot accidentally package a dev Function.
    await bundleFunction(resolveProfile("production").entry);
    compileWasm();
    assertProductionCleanArtifacts();
  }
}

if (functionProfile === "production") {
  assertProductionCleanArtifacts();
}

if (functionProfile === "bisect-stage-2") {
  assertStage2CleanArtifacts();
}
