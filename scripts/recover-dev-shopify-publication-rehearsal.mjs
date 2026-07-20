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
  DEV_PUBLICATION_REHEARSAL_RUN_ID,
  assertRehearsalOperationIsolated,
  buildDevPublicationRehearsalReconciliationQuery,
} from "./dev-shopify-publication-rehearsal.execution.js";
import { createDevPublicationRehearsalRecovery } from "./dev-shopify-publication-rehearsal.recovery.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cliEntrypoint = join(process.env.APPDATA ?? "", "npm", "node_modules", "@shopify", "cli", "bin", "run.js");
const directory = await mkdtemp(join(tmpdir(), "aces-dev-publication-recovery-"));
const executeCli = createShopifyCliReadSafeExecutor({
  cliEntrypoint,
  directory,
  execFileAsync,
  root,
  target: DEV_PUBLICATION_REHEARSAL_TARGET,
});

try {
  // This is deliberately the only source of recovery preconditions. A changed
  // resource fails before any mutation is sent.
  const initial = await execute(buildDevPublicationRehearsalReconciliationQuery());
  const recovery = createDevPublicationRehearsalRecovery(toRemote(initial.data));
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

  if (recovery.steps.write_revision) await persistence.writeRevision({ revision: recovery.target.revision });
  if (recovery.steps.write_definition) await persistence.writeBundleDefinition({ definition: recovery.target.definition });
  if (recovery.steps.write_publication) {
    await persistence.writePublicationRecord({
      publication_id: recovery.identifiers.baselinePublicationId,
      record: recovery.target.publication,
    });
  }

  const final = toRemote((await execute(buildDevPublicationRehearsalReconciliationQuery())).data);
  const verified = createDevPublicationRehearsalRecovery(final);
  if (verified.status !== "already_recovered") {
    throw new Error("recovery read-back did not reach the approved completed state");
  }
  process.stdout.write(`${JSON.stringify({
    status: "recovered",
    run_id: DEV_PUBLICATION_REHEARSAL_RUN_ID,
    completed_steps: recovery.steps,
    snapshot_checksum: verified.snapshot_ref.checksum,
    snapshot_compare_digest: verified.remote_compare_digests.snapshot,
    active_pointer_compare_digest: verified.remote_compare_digests.active_revision,
    active_revision_id: verified.target.definition.active_revision_id,
  }, null, 2)}\n`);
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
    activeRevision: carrier(data.product?.activeRevision, "active revision pointer"),
  };
}

function document(node) {
  if (node === null || node === undefined) return null;
  const field = node.fields?.find((candidate) => candidate.key === "document");
  if (!field) throw new Error(`rehearsal ${node.handle ?? "Metaobject"} has no document field`);
  return parseJson(field.jsonValue ?? field.value, `Metaobject ${node.handle}`);
}

function carrier(metafield, label) {
  if (!metafield) throw new Error(`isolated ${label} is missing`);
  return {
    document: metafield.jsonValue === null || metafield.jsonValue === undefined
      ? metafield.value
      : parseJson(metafield.jsonValue, label),
    compareDigest: metafield.compareDigest ?? null,
  };
}

function parseJson(value, label) {
  if (value && typeof value === "object") return structuredClone(value);
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

async function execute(query, { variables = {} } = {}) {
  assertRehearsalOperationIsolated(query);
  return executeCli(query, { variables });
}
