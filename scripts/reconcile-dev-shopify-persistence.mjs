import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  DEV_PERSISTENCE_RECONCILIATION_TARGET,
  assertReadOnlyGraphql,
  buildDevPersistenceReconciliationQuery,
  summarizeDevPersistenceReconciliation,
} from "./dev-shopify-persistence-reconciliation.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cliEntrypoint = join(process.env.APPDATA ?? "", "npm", "node_modules", "@shopify", "cli", "bin", "run.js");
const query = assertReadOnlyGraphql(buildDevPersistenceReconciliationQuery());
const directory = await mkdtemp(join(tmpdir(), "aces-dev-persistence-reconciliation-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint,
  directory,
  execFileAsync,
  root,
  target: DEV_PERSISTENCE_RECONCILIATION_TARGET,
});

try {
  const payload = await execute(query);
  console.log(JSON.stringify(summarizeDevPersistenceReconciliation(payload), null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
