import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assessNativeBundleMigrationAcceptance } from "./native-bundle-migration.js";

export function parseNativeBundleMigrationAcceptanceArguments(args) {
  if (args.some((argument) => ["--apply", "--write", "--execute", "--unlink"].includes(argument))) {
    throw new Error("this command is a read-only evidence checker");
  }
  if (args.length !== 2 || args[0] !== "--input" || !args[1]) {
    throw new Error("usage: node scripts/check-native-bundle-migration-acceptance.mjs --input <evidence.json>");
  }
  return { inputPath: args[1] };
}

export async function checkNativeBundleMigrationAcceptance({ inputPath }) {
  const input = JSON.parse(await readFile(resolve(process.cwd(), inputPath), "utf8"));
  return assessNativeBundleMigrationAcceptance(input);
}

async function main() {
  const result = await checkNativeBundleMigrationAcceptance(
    parseNativeBundleMigrationAcceptanceArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.accepted ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
