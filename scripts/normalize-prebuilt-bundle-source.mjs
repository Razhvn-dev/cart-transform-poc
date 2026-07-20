import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createDeclarativePrebuiltBundleSourceAdapter,
} from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.declarative-source.js";
import {
  collectPrebuiltBundleImportSourceRecords,
} from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.source-adapter.js";

export async function normalizePrebuiltBundleSource({
  exportDocument,
  mappingProfile,
  pageSize = 100,
  maxRecords = 10_000,
} = {}) {
  const adapter = createDeclarativePrebuiltBundleSourceAdapter({
    profile: mappingProfile,
    export_document: exportDocument,
    max_records: maxRecords,
  });
  const sourceRecords = await collectPrebuiltBundleImportSourceRecords({
    adapter,
    page_size: pageSize,
    max_records: maxRecords,
  });
  return Object.freeze({
    source_export: adapter.source_export,
    source_records: sourceRecords,
  });
}

export function parseNormalizeSourceArguments(args) {
  const options = { inputPath: null, mappingPath: null, pageSize: 100, maxRecords: 10_000 };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (["--apply", "--write", "--output"].includes(key)) {
      throw new Error("this command is read-only and prints normalized records to stdout");
    }
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument "${key}"`);
    if (key === "--input") options.inputPath = value;
    else if (key === "--mapping") options.mappingPath = value;
    else if (key === "--page-size") options.pageSize = parsePositiveInteger(value, key);
    else if (key === "--max-records") options.maxRecords = parsePositiveInteger(value, key);
    else throw new Error(`unsupported argument "${key}"`);
    index += 2;
  }
  if (!options.inputPath || !options.mappingPath) {
    throw new Error("usage: node scripts/normalize-prebuilt-bundle-source.mjs --input <export.json> --mapping <mapping.json>");
  }
  return options;
}

async function main() {
  const options = parseNormalizeSourceArguments(process.argv.slice(2));
  const [exportDocument, mappingProfile] = await Promise.all([
    readJson(options.inputPath),
    readJson(options.mappingPath),
  ]);
  const result = await normalizePrebuiltBundleSource({
    exportDocument,
    mappingProfile,
    pageSize: options.pageSize,
    maxRecords: options.maxRecords,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
}

function parsePositiveInteger(value, field) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${field} must be a positive integer`);
  }
  return Number(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
