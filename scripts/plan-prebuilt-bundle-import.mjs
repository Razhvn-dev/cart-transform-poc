import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPrebuiltBundleImportPlanFromPackage } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.package.js";

export async function planPrebuiltBundleImport({ inputPath, existingParentVariantGids = [] }) {
  const input = JSON.parse(await readFile(resolve(process.cwd(), inputPath), "utf8"));
  return createPrebuiltBundleImportPlanFromPackage(input, {
    existing_parent_variant_gids: existingParentVariantGids,
  });
}

export function parsePrebuiltImportPlanArguments(args) {
  const result = { inputPath: null, existingParentVariantGids: [] };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (key === "--apply") throw new Error("this command is local-only and has no apply mode");
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument "${key}"`);
    if (key === "--input") result.inputPath = value;
    else if (key === "--existing-parent-variants") result.existingParentVariantGids = JSON.parse(value);
    else throw new Error(`unsupported argument "${key}"`);
    index += 2;
  }
  if (!result.inputPath) throw new Error("usage: node scripts/plan-prebuilt-bundle-import.mjs --input <import-package.json>");
  if (!Array.isArray(result.existingParentVariantGids)) {
    throw new Error("--existing-parent-variants must be a JSON array");
  }
  return result;
}

async function main() {
  const options = parsePrebuiltImportPlanArguments(process.argv.slice(2));
  const result = await planPrebuiltBundleImport(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
