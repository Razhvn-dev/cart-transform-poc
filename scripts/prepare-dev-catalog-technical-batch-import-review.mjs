import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { prepareDevCatalogTechnicalBatchImportReview } from "./dev-catalog-technical-batch-import-review.js";

const values = parse(process.argv.slice(2));
const [drafts, readiness, collisions, scope] = await Promise.all([read(values.drafts), read(values.readiness), read(values.collisions), read(values.scope)]);
const result = prepareDevCatalogTechnicalBatchImportReview({ drafts, readiness, collisions, scope });
if (values.output) await writeFile(resolve(process.cwd(), values.output), `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
const summary = { schema_version: result.schema_version, batch_id: result.batch_id, package_fingerprint: result.package_fingerprint, import_id: result.import_package.import_id, pilot_scope: result.import_package.pilot_scope, plan_summary: result.plan.summary, confirmation_token: result.plan.confirmation_token, output_path: values.output ? resolve(process.cwd(), values.output) : null, shopify_writes_performed: false };
process.stdout.write(`${JSON.stringify(values.summary ? summary : result, null, 2)}\n`);
process.exitCode = result.plan.summary.rejected > 0 ? 1 : 0;

function parse(args) {
  const value = { drafts: null, readiness: null, collisions: null, scope: null, output: null, summary: false };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (["--apply", "--write", "--execute", "--shopify"].includes(key)) throw new Error("this command only prepares a local dry-run import review");
    if (key === "--summary") { value.summary = true; index += 1; continue; }
    const item = args[index + 1]; if (!key?.startsWith("--") || !item) throw new Error(`invalid argument "${key}"`);
    if (key === "--drafts") value.drafts = item; else if (key === "--readiness") value.readiness = item; else if (key === "--collisions") value.collisions = item; else if (key === "--scope") value.scope = item; else if (key === "--output") value.output = item; else throw new Error(`unsupported argument "${key}"`);
    index += 2;
  }
  if (!value.drafts || !value.readiness || !value.collisions || !value.scope) throw new Error("drafts, readiness, collisions, and scope are required");
  return value;
}

async function read(path) { return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8")); }
