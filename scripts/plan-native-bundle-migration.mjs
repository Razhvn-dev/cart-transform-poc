import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { planNativeBundleMigration } from "./native-bundle-migration.js";

export function parseNativeBundleMigrationPlanArguments(args) {
  if (args.some((argument) => ["--apply", "--write", "--execute", "--unlink"].includes(argument))) {
    throw new Error("this command creates a local plan and cannot mutate Shopify");
  }
  if (args.length !== 2 || args[0] !== "--input" || !args[1]) {
    throw new Error("usage: node scripts/plan-native-bundle-migration.mjs --input <inventory.json>");
  }
  return { inputPath: args[1] };
}

export async function createNativeBundleMigrationPlan({ inputPath }) {
  const input = JSON.parse(await readFile(resolve(process.cwd(), inputPath), "utf8"));
  return planNativeBundleMigration(input);
}

async function main() {
  const result = await createNativeBundleMigrationPlan(
    parseNativeBundleMigrationPlanArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "invalid" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
