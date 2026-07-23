import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { masterKitConfigV1 } from "../extensions/master-kit-expand/src/config/fixtures/master-kit-config.v1.js";
import { executeDevPublicationCasProbe } from "./dev-shopify-publication-rehearsal.cas-probe.js";
import { assertRehearsalOperationIsolated } from "./dev-shopify-publication-rehearsal.execution.js";
import { DEV_PUBLICATION_REHEARSAL_TARGET } from "./dev-shopify-publication-rehearsal.js";
import { parseDevPublicationRehearsalCliCommand } from "./dev-shopify-publication-rehearsal.transport.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const namespace = "aces_dev";
const ownerId = masterKitConfigV1.parent.product_gid;
const command = parseDevPublicationRehearsalCliCommand({
  argv: process.argv.slice(2),
  operation: "cas_probe",
});
const probeId = command.probeId ?? randomUUID();
const ownerNonce = command.ownerNonce ?? randomUUID();
const key = `bundle_runtime_snapshot_publication_rehearsal_cas_probe_${probeId}`;
const cleanupEvidence = command.cleanupEvidence
  ? decodeCleanupEvidence(command.cleanupEvidence)
  : null;

if (command.mode !== "apply") {
  process.stdout.write(`${JSON.stringify({
    status: command.mode === "help" ? "help" : "local_plan",
    operation: command.operation,
    target: DEV_PUBLICATION_REHEARSAL_TARGET,
    probe: { namespace, key, probe_id: probeId, owner_nonce: ownerNonce, disposable: true },
    apply_required: true,
    exact_confirmation: command.confirmation,
    apply_arguments: [
      "--probe-id", probeId,
      "--owner-nonce", ownerNonce,
    ],
    mutation_retry: "prohibited",
    transport: "identity-bound Shopify CLI only",
    cleanup: "a separate invocation requires exact cleanup_evidence from a known stale rejection",
  }, null, 2)}\n`);
} else {
  const directory = await mkdtemp(join(tmpdir(), "aces-dev-publication-cas-probe-"));
  const executeCli = createShopifyCliReadSafeExecutor({
    cliEntrypoint: join(root, "node_modules", "@shopify", "cli", "bin", "run.js"),
    directory,
    execFileAsync: promisify(execFile),
    root,
    target: DEV_PUBLICATION_REHEARSAL_TARGET,
  });
  const execute = (query, { variables = {} } = {}) => executeCli(query, { variables });

  try {
    const result = await executeDevPublicationCasProbe({
      probe: { key, ownerNonce, cleanupEvidence },
      set: async ({ key: mutationKey, value, compareDigest }) => {
        const payload = await execute(assertRehearsalOperationIsolated(`#graphql
          mutation DevPublicationRehearsalCasProbeSet($metafields: [MetafieldsSetInput!]!) {
            result: metafieldsSet(metafields: $metafields) {
              metafields { key value compareDigest }
              userErrors { code message }
            }
          }
        `), {
          variables: { metafields: [{
            ownerId,
            namespace,
            key: mutationKey,
            type: "json",
            value: JSON.stringify(value),
            compareDigest,
          }] },
        });
        return payload.data.result;
      },
      read: async ({ key: readKey }) => {
        const payload = await execute(readQuery(), {
          variables: { productId: ownerId, namespace, key: readKey },
        });
        return payload.data.product?.probe ?? null;
      },
      remove: async (evidence) => {
        const variables = { productId: ownerId, namespace, key: evidence.key };
        const current = (await execute(readQuery(), { variables })).data.product?.probe ?? null;
        if (current?.value !== evidence.value || current?.compareDigest !== evidence.compare_digest) {
          throw new Error("CAS probe cleanup evidence drifted immediately before delete");
        }
        const payload = await execute(assertRehearsalOperationIsolated(`#graphql
          mutation DevPublicationRehearsalCasProbeDelete($metafields: [MetafieldIdentifierInput!]!) {
            result: metafieldsDelete(metafields: $metafields) {
              deletedMetafields { ownerId namespace key }
              userErrors { message }
            }
          }
        `), { variables: { metafields: [{ ownerId, namespace, key: evidence.key }] } });
        const result = payload.data.result;
        if (!result.userErrors?.length && (await execute(readQuery(), { variables })).data.product?.probe) {
          result.userErrors = [{ code: "CLEANUP_READBACK_FAILED", message: "CAS probe remained after delete" }];
        }
        return result;
      },
    });
    process.stdout.write(`${JSON.stringify({
      ...result,
      ...(result.cleanup_evidence
        ? { cleanup_token: Buffer.from(JSON.stringify(result.cleanup_evidence)).toString("base64url") }
        : {}),
      probe: { namespace, key, probe_id: probeId, owner_nonce: ownerNonce },
    }, null, 2)}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function readQuery() {
  return assertRehearsalOperationIsolated(`#graphql
    query DevPublicationRehearsalCasProbeRead($productId: ID!, $namespace: String!, $key: String!) {
      product(id: $productId) {
        probe: metafield(namespace: $namespace, key: $key) { value compareDigest }
      }
    }
  `);
}

function decodeCleanupEvidence(value) {
  try {
    const result = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!result || typeof result !== "object") throw new Error();
    return result;
  } catch {
    throw new Error("--cleanup-evidence must be the exact cleanup token from a known stale rejection");
  }
}
