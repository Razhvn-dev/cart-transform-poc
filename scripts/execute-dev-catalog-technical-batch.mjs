import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

import { createDevShopifyPersistenceAdapter, DEV_SHOPIFY_APP_CLIENT_ID } from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import { executeDevCatalogTechnicalBatch, DEV_CATALOG_TECHNICAL_BATCH_TARGET } from "./dev-catalog-technical-batch-executor.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";
import { createShopifySessionAdminExecutor } from "./shopify-session-admin-executor.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = parseArgs(process.argv.slice(2));
const importReview = JSON.parse(await readFile(resolve(root, args.importReviewPath), "utf8"));
const manifest = JSON.parse(await readFile(resolve(root, args.manifestPath), "utf8"));
const reconciliationEvidence = args.reconciliationEvidencePath
  ? JSON.parse(await readFile(join(root, args.reconciliationEvidencePath), "utf8"))
  : null;
const directory = await mkdtemp(join(tmpdir(), "aces-dev-catalog-technical-batch-"));
let prisma = null;
try {
  let execute = createShopifyCliReadSafeExecutor({
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
  if (args.sessionTransport) {
    const credentials = parseEnvFile(await readFile(join(root, ".env.docker"), "utf8"));
    if (credentials.SHOPIFY_API_KEY !== DEV_SHOPIFY_APP_CLIENT_ID) throw new Error("local credentials do not belong to cart-transform-poc-dev");
    prisma = new PrismaClient();
    execute = createShopifySessionAdminExecutor({
      prisma,
      shop: DEV_CATALOG_TECHNICAL_BATCH_TARGET.store,
      apiVersion: "2026-04",
      clientId: credentials.SHOPIFY_API_KEY,
      clientSecret: credentials.SHOPIFY_API_SECRET,
    });
  }
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
  await prisma?.$disconnect();
  await rm(directory, { recursive: true, force: true });
}

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const confirmationIndex = argv.indexOf("--confirm");
  const sourceIndex = argv.indexOf("--source");
  return {
    apply,
    sessionTransport: argv.includes("--session-transport"),
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

function parseEnvFile(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return [];
    const separator = trimmed.indexOf("=");
    if (separator < 1) return [];
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[key, value]];
  }));
}
