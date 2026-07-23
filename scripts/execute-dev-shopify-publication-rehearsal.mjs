import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { DEV_PUBLICATION_REHEARSAL_TARGET } from "./dev-shopify-publication-rehearsal.js";
import {
  DEV_PUBLICATION_REHEARSAL_RUN_ID,
  assertRehearsalOperationIsolated,
  buildDevPublicationRehearsalReconciliationQuery,
  summarizeDevPublicationRehearsalReconciliation,
} from "./dev-shopify-publication-rehearsal.execution.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";
import {
  parseDevPublicationRehearsalCliCommand,
} from "./dev-shopify-publication-rehearsal.transport.js";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const command = parseDevPublicationRehearsalCliCommand({
  argv: process.argv.slice(2),
  operation: "full_rehearsal",
});
const runId = DEV_PUBLICATION_REHEARSAL_RUN_ID;

if (command.mode !== "reconcile") {
  process.stdout.write(`${JSON.stringify({
    status: command.mode === "help" ? "help" : "local_plan",
    operation: command.operation,
    target: DEV_PUBLICATION_REHEARSAL_TARGET,
    mutation_path: "disabled",
    recovery_commands: [
      "npm run recover:shopify-publication-rehearsal:dev",
      "npm run seed:shopify-publication-rehearsal-candidate:dev",
      "npm run recover:shopify-publication-rehearsal-candidate:dev",
      "npm run recover:shopify-publication-rehearsal-rollback:dev",
      "npm run verify:shopify-publication-rehearsal-cas:dev",
    ],
    live_reconciliation: "requires explicit --reconcile-only",
  }, null, 2)}\n`);
} else {
  const cliEntrypoint = join(root, "node_modules", "@shopify", "cli", "bin", "run.js");
  const directory = await mkdtemp(join(tmpdir(), "aces-dev-publication-rehearsal-"));
  const executeCli = createShopifyCliReadSafeExecutor({
    cliEntrypoint,
    directory,
    execFileAsync,
    root,
    target: DEV_PUBLICATION_REHEARSAL_TARGET,
    timeoutMs: 180_000,
  });
  try {
    const execute = (query, { variables = {} } = {}) => {
      assertRehearsalOperationIsolated(query);
      return executeCli(query, { variables });
    };
    const payload = await execute(buildDevPublicationRehearsalReconciliationQuery(runId));
    const output = command.summary
      ? { status: "read_only", run_id: runId, summary: summarizeDevPublicationRehearsalReconciliation(payload.data) }
      : { status: "read_only", run_id: runId, remote: payload.data };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
