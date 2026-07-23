import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDevShopifyPersistenceAdapter, DEV_SHOPIFY_APP_CLIENT_ID } from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import { executeDevCatalogTechnicalBatch, DEV_CATALOG_TECHNICAL_BATCH_TARGET } from "./dev-catalog-technical-batch-executor.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const root = fileURLToPath(new URL("..", import.meta.url));
if (process.argv.includes("--session-transport")) {
  throw new Error("session transport is disabled until trusted app identity is available");
}
const args = parseArgs(process.argv.slice(2));
const importReview = JSON.parse(await readFile(resolve(root, args.importReviewPath), "utf8"));
const manifest = JSON.parse(await readFile(resolve(root, args.manifestPath), "utf8"));
const reconciliationEvidence = args.reconciliationEvidencePath
  ? JSON.parse(await readFile(join(root, args.reconciliationEvidencePath), "utf8"))
  : null;
const directory = await mkdtemp(join(tmpdir(), "aces-dev-catalog-technical-batch-"));
try {
  const execute = createShopifyCliReadSafeExecutor({
    cliEntrypoint: join(root, "node_modules", "@shopify", "cli", "bin", "run.js"),
    directory,
    execFileAsync: promisify(execFile),
    root,
    target: {
      appConfig: DEV_CATALOG_TECHNICAL_BATCH_TARGET.appConfig,
      store: DEV_CATALOG_TECHNICAL_BATCH_TARGET.store,
      apiVersion: "2026-04",
    },
    readOnlyAttempts: 8,
    timeoutMs: 60_000,
  });
  const persistence = createDevShopifyPersistenceAdapter({
    appClientId: DEV_SHOPIFY_APP_CLIENT_ID,
    execute,
  });
  const result = await executeDevCatalogTechnicalBatch({
    importReview,
    manifest,
    persistence,
    apply: args.apply,
    confirmation: args.confirmation,
    sourceIdentity: args.sourceIdentity,
    reconciliationEvidence,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

function parseArgs(argv) {
  if (argv.includes("--session-transport")) {
    throw new Error("session transport is disabled until trusted app identity is available");
  }
  const apply = argv.includes("--apply");
  const confirmationIndex = argv.indexOf("--confirm");
  const sourceIndex = argv.indexOf("--source");
  return {
    apply,
    confirmation: confirmationIndex >= 0 ? argv[confirmationIndex + 1] : null,
    sourceIdentity: sourceIndex >= 0 ? argv[sourceIndex + 1] : null,
    reconciliationEvidencePath: readOption(argv, "--reconciliation-evidence"),
    importReviewPath: readOption(argv, "--import-review") ?? ".local/dev-catalog-technical-batch-import-review-v2-2026-07-21.json",
    manifestPath: readOption(argv, "--manifest") ?? ".local/dev-catalog-technical-batch-execution-manifest-2026-07-21.json",
  };
}

function readOption(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}
