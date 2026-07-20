import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createDevPublicationRehearsalPlan } from "./dev-shopify-publication-rehearsal.js";

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.apply) {
    throw new Error("this command is local-only and has no apply mode");
  }
  if (!options.baseline || !options.candidate) {
    throw new Error("usage: node scripts/plan-dev-shopify-publication-rehearsal.mjs --baseline <config.json> --candidate <config.json>");
  }

  const [baselineConfiguration, candidateConfiguration] = await Promise.all([
    readJson(options.baseline),
    readJson(options.candidate),
  ]);
  const plan = createDevPublicationRehearsalPlan({
    runId: options.runId ?? randomUUID(),
    baselineRevisionId: options.baselineRevisionId ?? randomUUID(),
    candidateRevisionId: options.candidateRevisionId ?? randomUUID(),
    baselinePublicationId: options.baselinePublicationId ?? randomUUID(),
    candidatePublicationId: options.candidatePublicationId ?? randomUUID(),
    baselineConfiguration,
    candidateConfiguration,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

async function readJson(file) {
  return JSON.parse(await readFile(resolve(file), "utf8"));
}

function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (key === "--apply") {
      result.apply = true;
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument "${key}"`);
    result[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 2;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
