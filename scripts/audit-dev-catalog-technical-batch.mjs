import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { auditDevCatalogTechnicalBatch } from "./dev-catalog-technical-batch-readiness.js";

const options = parseArguments(process.argv.slice(2));
const [catalogReport, scope] = await Promise.all([readJson(options.inputPath), readJson(options.scopePath)]);
const report = auditDevCatalogTechnicalBatch({ catalogReport, scope });
if (options.outputPath) {
  await writeFile(resolve(process.cwd(), options.outputPath), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}
process.stdout.write(`${JSON.stringify(options.summaryOnly ? summarize(report, options.outputPath) : report, null, 2)}\n`);
process.exitCode = report.scope_issues.some((item) => item.severity === "error") || report.summary.blocked > 0 ? 1 : 0;

export function parseArguments(args) {
  const options = { inputPath: null, scopePath: null, outputPath: null, summaryOnly: false };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (["--apply", "--write", "--execute", "--shopify"].includes(key)) throw new Error("this command is a local read-only audit");
    if (key === "--summary") {
      options.summaryOnly = true;
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument "${key}"`);
    if (key === "--input") options.inputPath = value;
    else if (key === "--scope") options.scopePath = value;
    else if (key === "--output") options.outputPath = value;
    else throw new Error(`unsupported argument "${key}"`);
    index += 2;
  }
  if (!options.inputPath || !options.scopePath) throw new Error("usage: provide --input and --scope");
  return options;
}

function summarize(report, outputPath) {
  return {
    schema_version: report.schema_version,
    mode: report.mode,
    batch_id: report.batch_id,
    summary: report.summary,
    scope_issues: report.scope_issues,
    records: report.records.map(({ parent_sku, status, issues }) => ({ parent_sku, status, issue_codes: issues.map((item) => item.code) })),
    checksum: report.checksum,
    output_path: outputPath ? resolve(process.cwd(), outputPath) : null,
    shopify_writes_performed: false,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
}
