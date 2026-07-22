import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createDevCatalogTechnicalBatchExecutionManifest } from "./dev-catalog-technical-batch-execution-manifest.js";

const options = parse(process.argv.slice(2));
const [importReview, drafts, collisions, scope] = await Promise.all([
  read(options.importReview), read(options.drafts), read(options.collisions), read(options.scope),
]);
const manifest = createDevCatalogTechnicalBatchExecutionManifest({ importReview, drafts, collisions, scope });
if (options.output) await writeFile(resolve(process.cwd(), options.output), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify(options.summary ? summarize(manifest, options.output) : manifest, null, 2)}\n`);

function parse(args) {
  const value = { importReview: null, drafts: null, collisions: null, scope: null, output: null, summary: false };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (["--apply", "--write", "--execute", "--shopify"].includes(key)) throw new Error("manifest preparation cannot execute Shopify writes");
    if (key === "--summary") { value.summary = true; index += 1; continue; }
    const item = args[index + 1]; if (!key?.startsWith("--") || !item) throw new Error(`invalid argument "${key}"`);
    if (key === "--import-review") value.importReview = item; else if (key === "--drafts") value.drafts = item; else if (key === "--collisions") value.collisions = item; else if (key === "--scope") value.scope = item; else if (key === "--output") value.output = item; else throw new Error(`unsupported argument "${key}"`);
    index += 2;
  }
  if (!value.importReview || !value.drafts || !value.collisions || !value.scope) throw new Error("import-review, drafts, collisions, and scope are required");
  return value;
}

function summarize(manifest, output) {
  return { schema_version: manifest.schema_version, target: { app: manifest.app, config: manifest.app_config, store: manifest.store_domain }, batch_id: manifest.batch_id, exact_apply_confirmation: manifest.exact_apply_confirmation, records: manifest.records.map(({ source_identity, bundle_definition_id, revision_id, publication_id, snapshot_checksum, projection_checksum }) => ({ source_identity, bundle_definition_id, revision_id, publication_id, snapshot_checksum, projection_checksum })), checksum: manifest.checksum, output_path: output ? resolve(process.cwd(), output) : null, shopify_writes_performed: false };
}

async function read(path) { return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8")); }
