import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { planDevCatalogAcceptanceInventoryWindows } from "./dev-catalog-acceptance-inventory-plan.js";
import { prepareRustBreadthInventoryReadback } from "./rust-projection-dev-integration.js";

const input = readOption("--input");
const output = readOption("--output");
if (!input || !output) {
  throw new Error("Usage: plan-rust-projection-breadth-inventory.mjs --input <live-readback> --output <plan>");
}
if (process.argv.some((value) => ["--apply", "--execute", "--write-shopify"].includes(value))) {
  throw new Error("This command creates a local inventory plan only.");
}

const root = resolve(import.meta.dirname, "..");
const liveReadback = JSON.parse(await readFile(resolve(root, input), "utf8"));
const scopedReadback = prepareRustBreadthInventoryReadback(liveReadback);
const plan = planDevCatalogAcceptanceInventoryWindows({ liveReadback: scopedReadback });
if (!plan.complete) throw new Error(`Rust breadth inventory plan is blocked: ${JSON.stringify(plan.blockers)}.`);
await writeFile(resolve(root, output), `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify(plan, null, 2));

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
