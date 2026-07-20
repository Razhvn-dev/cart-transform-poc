import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { DEV_SHOPIFY_APP_CLIENT_ID, createDevShopifyPersistenceAdapter } from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import { DEV_PUBLICATION_REHEARSAL_BINDINGS, DEV_PUBLICATION_REHEARSAL_TARGET } from "./dev-shopify-publication-rehearsal.js";
import {
  assertRehearsalOperationIsolated,
  buildDevPublicationRehearsalReconciliationQuery,
  summarizeDevPublicationRehearsalReconciliation,
} from "./dev-shopify-publication-rehearsal.execution.js";
import { createDevPublicationCandidateRecovery } from "./dev-shopify-publication-rehearsal.candidate-recovery.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cliEntrypoint = join(process.env.APPDATA ?? "", "npm", "node_modules", "@shopify", "cli", "bin", "run.js");
const directory = await mkdtemp(join(tmpdir(), "aces-dev-publication-candidate-seed-"));
const executeCli = createShopifyCliReadSafeExecutor({
  cliEntrypoint,
  directory,
  execFileAsync,
  root,
  target: DEV_PUBLICATION_REHEARSAL_TARGET,
});

try {
  const before = await execute(buildDevPublicationRehearsalReconciliationQuery());
  const recovery = createDevPublicationCandidateRecovery(toRemote(before.data));
  if (recovery.status === "candidate_recovered" || recovery.status === "ready_to_publish") {
    process.stdout.write(`${JSON.stringify({ status: recovery.status, summary: summarizeDevPublicationRehearsalReconciliation(before.data) }, null, 2)}\n`);
  } else if (recovery.status === "needs_candidate_seed") {
    const persistence = createDevShopifyPersistenceAdapter({
      appClientId: DEV_SHOPIFY_APP_CLIENT_ID,
      bindings: {
        metaobjectTypes: {
          bundleDefinition: "$app:aces_bundle_definition_dev",
          bundleRevision: "$app:aces_bundle_revision_dev",
          publicationRecord: "$app:aces_bundle_publication_record_dev",
        },
        documentFieldKey: "document",
        metafields: DEV_PUBLICATION_REHEARSAL_BINDINGS,
      },
      execute,
    });
    await persistence.writeRevision({ revision: recovery.candidate_draft });
    const after = await execute(buildDevPublicationRehearsalReconciliationQuery());
    const verified = createDevPublicationCandidateRecovery(toRemote(after.data));
    if (verified.status !== "ready_to_publish") throw new Error("candidate seed read-back did not produce an isolated draft");
    process.stdout.write(`${JSON.stringify({ status: "candidate_seeded", summary: summarizeDevPublicationRehearsalReconciliation(after.data) }, null, 2)}\n`);
  } else {
    throw new Error(`candidate seed cannot continue from ${recovery.status}`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

function toRemote(data) {
  return {
    definition: document(data.definition),
    baselineRevision: document(data.baselineRevision),
    candidateRevision: document(data.candidateRevision),
    baselinePublication: document(data.baselinePublication),
    candidatePublication: document(data.candidatePublication),
    rollbackPublication: document(data.rollbackPublication),
    snapshot: carrier(data.product?.snapshot, "Snapshot"),
    activeRevision: carrier(data.product?.activeRevision, "active pointer"),
  };
}

function document(node) {
  if (!node) return null;
  const field = node.fields?.find((candidate) => candidate.key === "document");
  if (!field) throw new Error("rehearsal Metaobject document field is missing");
  return field.jsonValue ?? JSON.parse(field.value);
}

function carrier(metafield, label) {
  if (!metafield) throw new Error(`isolated ${label} is missing`);
  return { document: metafield.jsonValue ?? metafield.value, compareDigest: metafield.compareDigest ?? null };
}

async function execute(query, { variables = {} } = {}) {
  assertRehearsalOperationIsolated(query);
  return executeCli(query, { variables });
}
