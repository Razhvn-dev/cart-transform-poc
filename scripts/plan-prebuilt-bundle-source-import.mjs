import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createDeclarativePrebuiltBundleSourceAdapter } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.declarative-source.js";
import { createPrebuiltBundleImportPlanFromPackage } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.package.js";
import { createPrebuiltBundleImportPackageFromSource } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.source-package.js";

export async function planPrebuiltBundleSourceImport({
  exportDocument,
  mappingProfile,
  importId,
  mappings,
  pilotScope,
  existingParentVariantGids = [],
  existingParentBindings = [],
  pageSize = 100,
  maxRecords = 10_000,
} = {}) {
  const adapter = createDeclarativePrebuiltBundleSourceAdapter({
    profile: mappingProfile,
    export_document: exportDocument,
    max_records: maxRecords,
  });
  const packageResult = await createPrebuiltBundleImportPackageFromSource({
    adapter,
    import_id: importId,
    mappings,
    pilot_scope: pilotScope,
    page_size: pageSize,
    max_records: maxRecords,
  });
  if (!packageResult.ok) {
    return Object.freeze({ ok: false, errors: packageResult.errors, package_fingerprint: null, source_export: adapter.source_export, plan: null });
  }
  const planResult = createPrebuiltBundleImportPlanFromPackage(packageResult.value, {
    existing_parent_variant_gids: existingParentVariantGids,
    existing_parent_bindings: existingParentBindings,
  });
  return Object.freeze({
    ok: planResult.ok,
    errors: planResult.errors,
    package_fingerprint: packageResult.fingerprint,
    source_export: adapter.source_export,
    plan: planResult.plan,
  });
}

export function parseSourceImportPlanArguments(args) {
  const options = {
    inputPath: null,
    sourceMappingPath: null,
    targetMappingsPath: null,
    pilotScopePath: null,
    importId: null,
    existingParentVariantGids: [],
    existingParentBindings: [],
    pageSize: 100,
    maxRecords: 10_000,
  };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (["--apply", "--write", "--execute"].includes(key)) throw new Error("this command is a read-only dry-run planner");
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument "${key}"`);
    if (key === "--input") options.inputPath = value;
    else if (key === "--source-mapping") options.sourceMappingPath = value;
    else if (key === "--target-mappings") options.targetMappingsPath = value;
    else if (key === "--pilot-scope") options.pilotScopePath = value;
    else if (key === "--import-id") options.importId = value;
    else if (key === "--existing-parent-variants") options.existingParentVariantGids = parseJsonArray(value, key);
    else if (key === "--existing-parent-bindings") options.existingParentBindings = parseJsonArray(value, key);
    else if (key === "--page-size") options.pageSize = parsePositiveInteger(value, key);
    else if (key === "--max-records") options.maxRecords = parsePositiveInteger(value, key);
    else throw new Error(`unsupported argument "${key}"`);
    index += 2;
  }
  if (!options.inputPath || !options.sourceMappingPath || !options.targetMappingsPath
    || !options.pilotScopePath || !options.importId) {
    throw new Error("usage: provide --input, --source-mapping, --target-mappings, --pilot-scope, and --import-id");
  }
  return options;
}

async function main() {
  const options = parseSourceImportPlanArguments(process.argv.slice(2));
  const [exportDocument, mappingProfile, mappings, pilotScope] = await Promise.all([
    readJson(options.inputPath),
    readJson(options.sourceMappingPath),
    readJson(options.targetMappingsPath),
    readJson(options.pilotScopePath),
  ]);
  const result = await planPrebuiltBundleSourceImport({
    exportDocument,
    mappingProfile,
    importId: options.importId,
    mappings,
    pilotScope,
    existingParentVariantGids: options.existingParentVariantGids,
    existingParentBindings: options.existingParentBindings,
    pageSize: options.pageSize,
    maxRecords: options.maxRecords,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok && result.plan?.summary?.rejected === 0 ? 0 : 1;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
}

function parseJsonArray(value, field) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error(`${field} must be a JSON array`);
  return parsed;
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
