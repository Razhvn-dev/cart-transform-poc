import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { diagnosePrebuiltFunctionInput } from "./diagnose-prebuilt-function-input.js";

const inputIndex = process.argv.indexOf("--input");
const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : null;

if (!inputPath) {
  throw new Error("Usage: node scripts/diagnose-prebuilt-function-input.mjs --input <captured-run-input.json>");
}

const input = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
console.log(JSON.stringify(diagnosePrebuiltFunctionInput(input), null, 2));
