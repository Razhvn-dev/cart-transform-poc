import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { selectDevCatalogRepresentativeBatch } from "./dev-catalog-representative-batch-selection.js";

const options = parseArguments(process.argv.slice(2));
const catalogReport = JSON.parse(await readFile(resolve(process.cwd(), options.input), "utf8"));
const result = selectDevCatalogRepresentativeBatch({
  catalogReport,
  componentCounts: options.componentCounts,
  excludedParentSkus: options.excludedParentSkus,
});
if (options.output) {
  await writeFile(resolve(process.cwd(), options.output), `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.complete ? 0 : 1;

function parseArguments(args) {
  const options = { input: null, output: null, componentCounts: [], excludedParentSkus: [] };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (["--apply", "--write", "--execute", "--shopify"].includes(key)) throw new Error("this command is local and read-only");
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument "${key}"`);
    if (key === "--input") options.input = value;
    else if (key === "--output") options.output = value;
    else if (key === "--component-counts") options.componentCounts = value.split(",").map(Number);
    else if (key === "--exclude") options.excludedParentSkus = value.split(",").filter(Boolean);
    else throw new Error(`unsupported argument "${key}"`);
  }
  if (!options.input || options.componentCounts.length === 0) throw new Error("--input and --component-counts are required");
  return options;
}
