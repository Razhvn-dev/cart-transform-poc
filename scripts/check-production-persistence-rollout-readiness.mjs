import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateProductionPersistenceRolloutReadiness } from "./production-persistence-rollout-readiness.js";

const inputPath = readArgument("--input");
if (!inputPath) fail("usage: node scripts/check-production-persistence-rollout-readiness.mjs --input <evidence.json>");

let input;
try {
  input = JSON.parse(await readFile(resolve(process.cwd(), inputPath), "utf8"));
} catch (error) {
  fail(`could not read readiness input: ${error.message}`);
}

const readiness = evaluateProductionPersistenceRolloutReadiness(input);
process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);
process.exitCode = readiness.ok ? 0 : 1;

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
