import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { planDevCatalogAcceptanceInventoryWindows } from "./dev-catalog-acceptance-inventory-plan.js";

const inputIndex = process.argv.indexOf("--input");
const outputIndex = process.argv.indexOf("--output");
if (process.argv.some((value) => ["--apply", "--write", "--execute", "--shopify"].includes(value))) {
  throw new Error("this command creates a local inventory plan only");
}
if (inputIndex < 0 || !process.argv[inputIndex + 1]) throw new Error("--input is required");
const input = JSON.parse(await readFile(resolve(process.cwd(), process.argv[inputIndex + 1]), "utf8"));
const result = planDevCatalogAcceptanceInventoryWindows({ liveReadback: input });
if (outputIndex >= 0) {
  const output = process.argv[outputIndex + 1];
  if (!output) throw new Error("--output requires a path");
  await writeFile(resolve(process.cwd(), output), `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.complete ? 0 : 1;
