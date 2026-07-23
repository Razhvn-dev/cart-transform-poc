import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildRustHybridAcceptanceExecutorArguments,
  planRustHybridAcceptanceInventory,
} from "./rust-hybrid-acceptance-inventory.js";

const root = resolve(import.meta.dirname, "..");
const options = parseArguments(process.argv.slice(2));
const [catalogReadback, builderReadback] = await Promise.all([
  readJson(options.catalogReadbackPath),
  readJson(options.builderReadbackPath),
]);
const result = planRustHybridAcceptanceInventory({
  catalogReadback,
  builderReadback,
});

if (options.outputPath != null) {
  await writeFile(
    resolve(root, options.outputPath),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

if (!options.execute) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.complete ? 0 : 1;
} else {
  if (options.phase == null) {
    throw new Error("--execute requires --phase open or restore");
  }
  if (options.confirmation == null) {
    throw new Error(
      `--execute requires --confirm ${result.execution_confirmations[options.phase] ?? "<exact confirmation>"}`,
    );
  }
  const directory = await mkdtemp(join(tmpdir(), "rust-hybrid-inventory-execute-"));
  try {
    const planPath = join(directory, "inventory-plan.json");
    await writeFile(planPath, `${JSON.stringify(result.inventory_plan, null, 2)}\n`, "utf8");
    const executorArguments = buildRustHybridAcceptanceExecutorArguments({
      execute: true,
      phase: options.phase,
      confirmation: options.confirmation,
      planPath,
      result,
    });
    process.stderr.write(`${JSON.stringify({
      mode: "execute",
      window_id: result.window_id,
      phase: options.phase,
      plan_checksum: result.plan_checksum,
      selected: result.selected,
      no_action: result.no_action,
      blocked: result.blocked,
      executor: executorArguments[0],
      automatic_mutation_retries: false,
    }, null, 2)}\n`);
    const execution = spawnSync(process.execPath, executorArguments, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    if (execution.status !== 0) {
      throw new Error(
        `existing CAS inventory executor failed with status ${execution.status ?? "unknown"}`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function parseArguments(args) {
  const options = {
    catalogReadbackPath: null,
    builderReadbackPath: null,
    outputPath: null,
    execute: false,
    phase: null,
    confirmation: null,
  };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (key === "--execute") {
      if (options.execute) throw new Error("--execute must not be repeated");
      options.execute = true;
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (!key?.startsWith("--") || value == null || value.startsWith("--")) {
      throw new Error(`invalid argument ${key ?? "<missing>"}`);
    }
    if (key === "--catalog-readback") options.catalogReadbackPath = value;
    else if (key === "--builder-readback") options.builderReadbackPath = value;
    else if (key === "--output") options.outputPath = value;
    else if (key === "--phase") options.phase = value;
    else if (key === "--confirm") options.confirmation = value;
    else throw new Error(`unsupported argument ${key}`);
    index += 2;
  }
  if (options.catalogReadbackPath == null || options.builderReadbackPath == null) {
    throw new Error("--catalog-readback and --builder-readback are required");
  }
  if (options.phase != null && !["open", "restore"].includes(options.phase)) {
    throw new Error("--phase must be open or restore");
  }
  if (!options.execute && (options.phase != null || options.confirmation != null)) {
    throw new Error("--phase and --confirm require explicit --execute");
  }
  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}
