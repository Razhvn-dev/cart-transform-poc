import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { prepareDevCatalogTechnicalBatchDrafts } from "./dev-catalog-technical-batch-drafts.js";

const options = parseArguments(process.argv.slice(2));
const [catalogReport, readinessReport, liveReadback, scope] = await Promise.all([
  readJson(options.catalogPath), readJson(options.readinessPath), readJson(options.livePath), readJson(options.scopePath),
]);
const result = prepareDevCatalogTechnicalBatchDrafts({ catalogReport, readinessReport, liveReadback, scope });
if (options.outputPath) await writeFile(resolve(process.cwd(), options.outputPath), `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify(options.summaryOnly ? summarize(result, options.outputPath) : result, null, 2)}\n`);
process.exitCode = result.summary.blocked > 0 ? 1 : 0;

function parseArguments(args) {
  const options = { catalogPath: null, readinessPath: null, livePath: null, scopePath: null, outputPath: null, summaryOnly: false };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (["--apply", "--write", "--execute", "--shopify"].includes(key)) throw new Error("this command only prepares local drafts");
    if (key === "--summary") { options.summaryOnly = true; index += 1; continue; }
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument "${key}"`);
    if (key === "--catalog") options.catalogPath = value;
    else if (key === "--readiness") options.readinessPath = value;
    else if (key === "--live-readback") options.livePath = value;
    else if (key === "--scope") options.scopePath = value;
    else if (key === "--output") options.outputPath = value;
    else throw new Error(`unsupported argument "${key}"`);
    index += 2;
  }
  if (!options.catalogPath || !options.readinessPath || !options.livePath || !options.scopePath) throw new Error("catalog, readiness, live-readback, and scope are required");
  return options;
}

function summarize(result, outputPath) {
  return { schema_version: result.schema_version, batch_id: result.batch_id, summary: result.summary, records: result.records.map((record) => ({ parent_sku: record.parent_sku, status: record.status, definition_id: record.draft?.definition.bundle_definition_id ?? null, revision_id: record.draft?.revision.revision_id ?? null, snapshot_checksum: record.draft?.compile_preview.checksum ?? null })), checksum: result.checksum, output_path: outputPath ? resolve(process.cwd(), outputPath) : null, shopify_writes_performed: false };
}

async function readJson(path) { return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8")); }
