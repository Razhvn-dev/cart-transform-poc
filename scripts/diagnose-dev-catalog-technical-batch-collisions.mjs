import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { assessDevCatalogTechnicalBatchCollisions } from "./dev-catalog-technical-batch-collisions.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const TARGET = Object.freeze({ appConfig: "shopify.app.dev.toml", store: "huang-mvqquz1p.myshopify.com", apiVersion: "2026-04" });
const options = parseArguments(process.argv.slice(2));
const root = resolve(import.meta.dirname, "..");
const [drafts, liveReadback] = await Promise.all([readJson(options.draftsPath), readJson(options.livePath)]);
const directory = await mkdtemp(join(tmpdir(), "aces-dev-catalog-collision-readback-"));
const execute = createShopifyCliReadSafeExecutor({ cliEntrypoint: resolve(root, "node_modules/@shopify/cli/bin/run.js"), directory, execFileAsync: promisify(execFile), root, target: TARGET });
try {
  const definitions = [];
  let after = null;
  do {
    const payload = await execute(`#graphql
      query DevBundleDefinitions($type: String!, $after: String) {
        metaobjects(type: $type, first: 100, after: $after) {
          nodes { fields { key value jsonValue } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { variables: { type: "$app:aces_bundle_definition_dev", after } });
    const connection = payload.data.metaobjects;
    definitions.push(...connection.nodes.map(documentFromMetaobject).filter(Boolean));
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);
  const report = assessDevCatalogTechnicalBatchCollisions({ drafts, liveReadback, definitions });
  if (options.outputPath) await writeFile(resolve(root, options.outputPath), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.summary.blocked > 0 ? 1 : 0;
} finally {
  await rm(directory, { recursive: true, force: true });
}

function parseArguments(args) {
  const options = { draftsPath: null, livePath: null, outputPath: null };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (["--apply", "--write", "--execute"].includes(key)) throw new Error("this collision diagnostic is read-only");
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument "${key}"`);
    if (key === "--drafts") options.draftsPath = value;
    else if (key === "--live-readback") options.livePath = value;
    else if (key === "--output") options.outputPath = value;
    else throw new Error(`unsupported argument "${key}"`);
  }
  if (!options.draftsPath || !options.livePath) throw new Error("drafts and live-readback are required");
  return options;
}

function documentFromMetaobject(metaobject) {
  const field = metaobject?.fields?.find((candidate) => candidate.key === "document");
  return field?.jsonValue && typeof field.jsonValue === "object" ? field.jsonValue : null;
}

async function readJson(path) { return JSON.parse(await readFile(resolve(root, path), "utf8")); }
