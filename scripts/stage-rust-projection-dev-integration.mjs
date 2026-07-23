import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  TARGET,
  assertDeployableCandidateVersion,
  renderStagingAppConfig,
  renderStagingManifest,
  resolveStagingPaths,
} from "./rust-projection-dev-integration.js";

const root = resolve(import.meta.dirname, "..");
assertDeployableCandidateVersion(TARGET.candidateVersion);
const paths = resolveStagingPaths(root);
const sourceQuery = resolve(root, "extensions/master-kit-expand-rust-spike/src/run.graphql");
const sourceAppConfig = resolve(root, TARGET.sourceAppConfig);

for (const path of [paths.manifest, paths.query, paths.appConfig]) {
  mkdirSync(dirname(path), { recursive: true });
}
writeFileSync(paths.manifest, renderStagingManifest(), "utf8");
writeFileSync(paths.query, readFileSync(sourceQuery, "utf8"), "utf8");
writeFileSync(
  paths.appConfig,
  renderStagingAppConfig(readFileSync(sourceAppConfig, "utf8")),
  "utf8",
);

console.log(JSON.stringify({
  target: TARGET,
  paths,
  writesShopify: false,
}, null, 2));
