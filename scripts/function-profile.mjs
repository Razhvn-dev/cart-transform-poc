import { copyFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(__dirname, "..");
export const extDir = resolve(repoRoot, "extensions/master-kit-expand");

export const PRODUCTION_APP_CLIENT_ID = "529f335a66e6b1b2924ba30c1b8630b4";
export const DEV_APP_CLIENT_ID = "d25c62f609855572f3f266765d105ebb";

export const DEV_ONLY_TOKENS = [
  "aces_dev",
  "bundle_runtime_snapshot_test",
  "runtimeSnapshotDevMetafield",
];

export const DEV_SHADOW_TOKENS = [
  "bundle-runtime.dev-shadow",
  "bundle-runtime.shadow-comparison",
  "master-kit-config.v1",
  "bundle-runtime.compiler",
  "bundle-runtime.validator",
  "bundle-runtime.resolver",
  "candidate",
];

export const STAGE_2_FORBIDDEN_TOKENS = [
  ...DEV_ONLY_TOKENS,
  ...DEV_SHADOW_TOKENS,
];

export const profiles = {
  production: {
    entry: "src/run.js",
    query: "src/queries/run.production.graphql",
    forbidden: DEV_ONLY_TOKENS,
  },
  dev: {
    entry: "src/run.dev.js",
    query: "src/queries/run.dev.graphql",
    required: ["aces_dev", "bundle_runtime_snapshot_test"],
  },
  "bisect-stage-2": {
    entry: "src/run.dev.stage2.js",
    query: "src/queries/run.production.graphql",
    forbidden: STAGE_2_FORBIDDEN_TOKENS,
  },
  "bisect-stage-3": {
    entry: "src/run.dev.stage3.js",
    query: "src/queries/run.dev.graphql",
    required: ["aces_dev", "bundle_runtime_snapshot_test"],
  },
  "bisect-stage-4": {
    entry: "src/run.dev.stage4.js",
    query: "src/queries/run.dev.graphql",
    required: ["aces_dev", "bundle_runtime_snapshot_test"],
  },
  "bisect-stage-5": {
    entry: "src/run.dev.stage5.js",
    query: "src/queries/run.dev.graphql",
    required: ["aces_dev", "bundle_runtime_snapshot_test"],
  },
  "bisect-stage-6": {
    entry: "src/run.dev.stage6.js",
    query: "src/queries/run.dev.graphql",
    required: ["aces_dev", "bundle_runtime_snapshot_test"],
  },
  "bisect-stage-7": {
    entry: "src/run.dev.stage7.js",
    query: "src/queries/run.dev.graphql",
    required: ["aces_dev", "bundle_runtime_snapshot_test"],
  },
  "bisect-stage-8": {
    entry: "src/run.dev.stage8.js",
    query: "src/queries/run.dev.graphql",
    required: ["aces_dev", "bundle_runtime_snapshot_test"],
  },
  "prebuilt-observe": {
    entry: "src/run.dev.prebuilt-observe.js",
    query: "src/queries/run.dev.prebuilt-observe.graphql",
    required: ["aces_dev", "prebuilt_bundle_runtime_mapping_v1", "prebuiltRuntimeMappingMetafield"],
  },
  "prebuilt-resolve-observe": {
    entry: "src/run.dev.prebuilt-resolve-observe.js",
    query: "src/queries/run.dev.prebuilt-observe.graphql",
    required: ["aces_dev", "prebuilt_bundle_runtime_mapping_v1", "prebuiltRuntimeMappingMetafield"],
  },
  "prebuilt-candidate": {
    entry: "src/run.dev.prebuilt-candidate.js",
    query: "src/queries/run.dev.prebuilt-observe.graphql",
    required: ["aces_dev", "prebuilt_bundle_runtime_mapping_v1", "prebuiltRuntimeMappingMetafield"],
  },
  "prebuilt-candidate-static-fallback": {
    entry: "src/run.dev.prebuilt-candidate-static-fallback.js",
    query: "src/queries/run.dev.prebuilt-observe.graphql",
    required: ["aces_dev", "prebuilt_bundle_runtime_mapping_v1", "prebuiltRuntimeMappingMetafield"],
  },
  "prebuilt-projection-candidate": {
    entry: "src/run.dev.prebuilt-projection-candidate.js",
    query: "src/queries/run.dev.prebuilt-projection.graphql",
    required: ["aces_dev", "prebuilt_bundle_expand_projection_v1", "prebuiltExpandProjectionMetafield"],
  },
  "prebuilt-projection-static-fallback": {
    entry: "src/run.dev.prebuilt-projection-static-fallback.js",
    query: "src/queries/run.dev.prebuilt-projection.graphql",
    required: ["aces_dev", "prebuilt_bundle_expand_projection_v1", "prebuiltExpandProjectionMetafield"],
  },
  "prebuilt-static-probe": {
    entry: "src/run.dev.prebuilt-static-probe.js",
    query: "src/queries/run.production.graphql",
    forbidden: STAGE_2_FORBIDDEN_TOKENS,
  },
  "prebuilt-query-static-probe": {
    entry: "src/run.dev.prebuilt-static-probe.js",
    query: "src/queries/run.dev.prebuilt-observe.graphql",
    required: ["aces_dev", "prebuilt_bundle_runtime_mapping_v1", "prebuiltRuntimeMappingMetafield"],
  },
  "prebuilt-parse-static-probe": {
    entry: "src/run.dev.prebuilt-parse-static-probe.js",
    query: "src/queries/run.dev.prebuilt-observe.graphql",
    required: ["aces_dev", "prebuilt_bundle_runtime_mapping_v1", "prebuiltRuntimeMappingMetafield"],
  },
  "prebuilt-candidate-build-static-probe": {
    entry: "src/run.dev.prebuilt-candidate-build-static-probe.js",
    query: "src/queries/run.dev.prebuilt-observe.graphql",
    required: ["aces_dev", "prebuilt_bundle_runtime_mapping_v1", "prebuiltRuntimeMappingMetafield"],
  },
  "prebuilt-candidate-import-static-probe": {
    entry: "src/run.dev.prebuilt-candidate-import-static-probe.js",
    query: "src/queries/run.dev.prebuilt-observe.graphql",
    required: ["aces_dev", "prebuilt_bundle_runtime_mapping_v1", "prebuiltRuntimeMappingMetafield"],
  },
  "prebuilt-metadata-lookup-static-probe": {
    entry: "src/run.dev.prebuilt-metadata-lookup-static-probe.js",
    query: "src/queries/run.dev.prebuilt-observe.graphql",
    required: ["aces_dev", "prebuilt_bundle_runtime_mapping_v1", "prebuiltRuntimeMappingMetafield"],
  },
};

const devAppOnlyProfiles = new Set([
  "dev",
  "bisect-stage-2",
  "bisect-stage-3",
  "bisect-stage-4",
  "bisect-stage-5",
  "bisect-stage-6",
  "bisect-stage-7",
  "bisect-stage-8",
  "prebuilt-observe",
  "prebuilt-resolve-observe",
  "prebuilt-candidate",
  "prebuilt-candidate-static-fallback",
  "prebuilt-projection-candidate",
  "prebuilt-projection-static-fallback",
  "prebuilt-static-probe",
  "prebuilt-query-static-probe",
  "prebuilt-parse-static-probe",
  "prebuilt-candidate-build-static-probe",
  "prebuilt-candidate-import-static-probe",
  "prebuilt-metadata-lookup-static-probe",
]);

const allowedDevConfigNames = new Set([
  "shopify.app.dev.toml",
  "shopify.app.local.toml",
]);

export function resolveProfile(profile) {
  const selected = profiles[profile];
  if (!selected) {
    throw new Error(`Unknown Function profile "${profile}"`);
  }

  return selected;
}

export function resolveAppConfigPath(appConfig) {
  if (!appConfig) return null;
  return resolve(repoRoot, appConfig);
}

export function readAppConfig(appConfig) {
  const configPath = resolveAppConfigPath(appConfig);
  if (!configPath) return null;

  const text = readFileSync(configPath, "utf8");
  return {
    path: configPath,
    name: parseTomlString(text, "name"),
    clientId: parseTomlString(text, "client_id"),
    text,
  };
}

export function assertProfileAppConfigAllowed(profile, appConfig) {
  resolveProfile(profile);
  if (!devAppOnlyProfiles.has(profile)) return;

  const config = readAppConfig(appConfig);
  if (!config) {
    throw new Error(
      `FUNCTION_PROFILE=${profile} requires SHOPIFY_APP_CONFIG or --app-config set to shopify.app.dev.toml or shopify.app.local.toml.`,
    );
  }

  const configFileName = config.path.split(/[\\/]/).pop();
  const isAllowedConfigName = allowedDevConfigNames.has(configFileName);
  const isDevClient = config.clientId === DEV_APP_CLIENT_ID;
  const isCustomDistributionConfig =
    configFileName === "shopify.app.toml" ||
    config.name === "cart-transform-poc" ||
    config.clientId === PRODUCTION_APP_CLIENT_ID;

  if (isCustomDistributionConfig || !isAllowedConfigName || !isDevClient) {
    throw new Error(
      `Refusing FUNCTION_PROFILE=${profile} with app config ${configFileName || appConfig}. Dev-only profiles are allowed only with shopify.app.dev.toml or shopify.app.local.toml for the cart-transform-poc-dev client.`,
    );
  }
}

export function prepareFunctionProfile(profile, options = {}) {
  assertProfileAppConfigAllowed(profile, options.appConfig);
  const selected = resolveProfile(profile);

  const sourceQuery = resolve(extDir, selected.query);
  const activeQuery = resolve(extDir, "src/run.graphql");
  copyFileSync(sourceQuery, activeQuery);
  assertActiveQueryMatchesProfile(profile);

  return selected;
}

// Shopify CLI reads input_query while packaging an already-built Function. The
// query must therefore be staged after a dev build restores local production
// artifacts, and remain staged only for the immediately following deploy.
export function stageFunctionProfileForDeployment(profile, options = {}) {
  return prepareFunctionProfile(profile, options);
}

export function restoreProductionFunctionProfile() {
  const selected = resolveProfile("production");
  const sourceQuery = resolve(extDir, selected.query);
  const activeQuery = resolve(extDir, "src/run.graphql");
  copyFileSync(sourceQuery, activeQuery);
  assertActiveQueryMatchesProfile("production");
}

export async function withTemporaryFunctionProfile(profile, options, callback) {
  assertProfileAppConfigAllowed(profile, options?.appConfig);
  prepareFunctionProfile(profile, options);

  try {
    return await callback(resolveProfile(profile));
  } finally {
    if (profile !== "production") {
      restoreProductionFunctionProfile();
    }
  }
}

export function assertActiveQueryMatchesProfile(profile) {
  const selected = resolveProfile(profile);
  const activeQuery = resolve(extDir, "src/run.graphql");
  const activeQueryText = readFileSync(activeQuery, "utf8");

  for (const token of selected.forbidden || []) {
    if (activeQueryText.includes(token)) {
      throw new Error(`Production Function query unexpectedly contains "${token}"`);
    }
  }

  for (const token of selected.required || []) {
    if (!activeQueryText.includes(token)) {
      throw new Error(`Dev Function query is missing "${token}"`);
    }
  }
}

export function assertProductionCleanArtifacts() {
  assertCleanArtifacts("production", [...DEV_ONLY_TOKENS, ...DEV_SHADOW_TOKENS]);
}

export function assertStage2CleanArtifacts() {
  assertCleanArtifacts("Stage 2", STAGE_2_FORBIDDEN_TOKENS);
}

export function assertStage3GeneratedInputType() {
  const generatedTypes = readFileSync(resolve(extDir, "generated/api.ts"), "utf8");

  for (const token of [
    "runtimeSnapshotDevMetafield",
    "jsonValue",
    "value",
  ]) {
    if (!generatedTypes.includes(token)) {
      throw new Error(`Stage 3 generated input types are missing "${token}"`);
    }
  }
}

export function assertPrebuiltObserveGeneratedInputType() {
  const generatedTypes = readFileSync(resolve(extDir, "generated/api.ts"), "utf8");

  for (const token of [
    "prebuiltRuntimeMappingMetafield",
    "prebuiltRuntimeSnapshotMetafield",
    "jsonValue",
    "value",
  ]) {
    if (!generatedTypes.includes(token)) {
      throw new Error(`Pre-built observe generated input types are missing "${token}"`);
    }
  }
}

export function assertPrebuiltProjectionGeneratedInputType() {
  const generatedTypes = readFileSync(resolve(extDir, "generated/api.ts"), "utf8");
  for (const token of ["prebuiltExpandProjectionMetafield", "jsonValue", "value"]) {
    if (!generatedTypes.includes(token)) {
      throw new Error(`Pre-built projection generated input types are missing "${token}"`);
    }
  }
}

function assertCleanArtifacts(profileLabel, artifactTokens) {
  const checks = [
    {
      label: `${profileLabel} active run.graphql`,
      path: resolve(extDir, "src/run.graphql"),
      tokens: artifactTokens,
    },
    {
      label: `${profileLabel} generated api.ts`,
      path: resolve(extDir, "generated/api.ts"),
      tokens: artifactTokens,
    },
    {
      label: `${profileLabel} dist/function.js`,
      path: resolve(extDir, "dist/function.js"),
      tokens: artifactTokens,
    },
  ];

  for (const check of checks) {
    const text = readFileSync(check.path, "utf8");
    for (const token of check.tokens) {
      if (text.includes(token)) {
        throw new Error(`${check.label} unexpectedly contains dev-only token "${token}"`);
      }
    }
  }
}

function parseTomlString(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match?.[1] ?? null;
}
