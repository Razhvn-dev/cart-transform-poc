import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  DEV_SHOPIFY_APP_CLIENT_ID,
  createDevShopifyPersistenceAdapter,
} from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import { DEV_PUBLICATION_REHEARSAL_BINDINGS, DEV_PUBLICATION_REHEARSAL_TARGET } from "./dev-shopify-publication-rehearsal.js";
import {
  assertRehearsalOperationIsolated,
  buildDevPublicationRehearsalReconciliationQuery,
} from "./dev-shopify-publication-rehearsal.execution.js";
import { executeDevPublicationCandidateRecovery } from "./dev-shopify-publication-rehearsal.candidate-recovery-execution.js";
import { parseDevPublicationRehearsalCliCommand } from "./dev-shopify-publication-rehearsal.transport.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const command = parseDevPublicationRehearsalCliCommand({
  argv: process.argv.slice(2),
  operation: "candidate_recovery",
});
if (command.mode !== "apply") {
  process.stdout.write(`${JSON.stringify({
    status: command.mode === "help" ? "help" : "local_plan",
    operation: command.operation,
    target: DEV_PUBLICATION_REHEARSAL_TARGET,
    apply_required: true,
    exact_confirmation: command.confirmation,
    mutation_retry: "prohibited",
    ambiguous_result: "stop and rerun this command only after independent reconciliation",
  }, null, 2)}\n`);
} else {
  const directory = await mkdtemp(join(tmpdir(), "aces-dev-publication-candidate-recovery-"));
  const executeCli = createShopifyCliReadSafeExecutor({
    cliEntrypoint: join(root, "node_modules", "@shopify", "cli", "bin", "run.js"),
    directory,
    execFileAsync: promisify(execFile),
    root,
    target: DEV_PUBLICATION_REHEARSAL_TARGET,
    timeoutMs: 180_000,
  });
  try {
    const execute = (query, { variables = {} } = {}) => {
      assertRehearsalOperationIsolated(query);
      return executeCli(query, { variables });
    };
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
    const readRemote = async () => toRemote((await execute(buildDevPublicationRehearsalReconciliationQuery())).data);
    const result = await executeDevPublicationCandidateRecovery({ readRemote, persistence });
    process.stdout.write(`${JSON.stringify({ ...result, target: DEV_PUBLICATION_REHEARSAL_TARGET }, null, 2)}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
