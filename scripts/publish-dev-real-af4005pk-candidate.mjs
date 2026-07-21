import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createBundlePublicationPersistenceDriver } from "../extensions/master-kit-expand/src/config/bundle-publication.persistence-driver.js";
import { publishDraftRevision } from "../extensions/master-kit-expand/src/config/bundle-publication.service.js";
import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { assertPrebuiltProjectionPublicationEvidence, buildPrebuiltProjectionPublicationEvidence } from "../extensions/master-kit-expand/src/config/prebuilt-projection-publication-evidence.js";
import { DEV_SHOPIFY_APP_CLIENT_ID, createDevShopifyPersistenceAdapter } from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const TARGET = Object.freeze({
  appConfig: "shopify.app.dev.toml",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
  definitionId: "4b5c384b-acc6-455d-b14a-7a1e6d433ffc",
  revisionId: "e94be6f4-e08d-483b-9dcc-d80b98ee4246",
  publicationId: "4b5c384b-acc6-455d-b14a-7a1e6d433ffe",
});

const apply = process.argv.includes("--apply");
const confirmation = `PUBLISH:${TARGET.definitionId}:${TARGET.revisionId}`;
if (apply && !process.argv.includes(`--confirm=${confirmation}`)) {
  throw new Error(`--apply requires --confirm=${confirmation}`);
}

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "aces-dev-real-projection-publish-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: resolve(root, "node_modules/@shopify/cli/bin/run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: TARGET,
});

try {
  const persistence = createDevShopifyPersistenceAdapter({ appClientId: DEV_SHOPIFY_APP_CLIENT_ID, execute });
  const definition = await persistence.readBundleDefinition(TARGET.definitionId);
  const revision = await persistence.readRevision(TARGET.revisionId);
  const snapshot = compileRuntimeSnapshot(revision.configuration);
  const evidenceResult = buildPrebuiltProjectionPublicationEvidence({
    definition,
    revision,
    snapshot,
    pilot_scope: {
      schema_version: "prebuilt_bundle_pilot_scope.v1",
      pilot_scope_id: TARGET.definitionId,
      store_domain: TARGET.store,
      approved_product_series_keys: ["real-af4005pk-demo"],
      approved_parent_variant_gids: [definition.parent_binding.variant_gid],
    },
  });
  const preflight = {
    target: TARGET,
    revision_status: revision.status,
    definition_active_revision_id: definition.active_revision_id,
    snapshot_checksum: snapshot.checksum,
    projection_checksum: evidenceResult.projection.checksum,
    components: evidenceResult.projection.components.map(({ sku, variant_gid, fixed_price_per_unit }) => ({ sku, variant_gid, fixed_price_per_unit })),
  };
  if (!apply) {
    console.log(JSON.stringify({ status: "read_only_ready", ...preflight, confirmation }, null, 2));
    process.exitCode = 0;
  } else {
    if (revision.status !== "draft" || definition.active_revision_id !== null) {
      throw new Error("candidate is no longer an unpublished first draft; reconcile before publishing");
    }
    // The exact publication handle is checked in the one-shot diagnostic
    // immediately before this command. Avoid the adapter's missing-handle and
    // unbounded-list reads here: both have repeatedly hit a Shopify CLI socket
    // reset before any mutation. This fixed, never-before-used ID is consumed
    // only by this controlled publication attempt.
    const baseDriver = createBundlePublicationPersistenceDriver({ persistence });
    const driver = {
      ...baseDriver,
      readPublicationRecord: async (publicationId) => {
        if (publicationId !== TARGET.publicationId) {
          throw new Error("unexpected publication ID");
        }
        return null;
      },
      runPromotionGates: ({ snapshot: attemptedSnapshot, revision: attemptedRevision, promotion }) => {
        try {
          assertPrebuiltProjectionPublicationEvidence(promotion?.evidence, {
            definition,
            revision: attemptedRevision,
            snapshot: attemptedSnapshot,
            projection: evidenceResult.projection,
          });
          return { ok: true, warnings: [] };
        } catch (error) {
          return { ok: false, reason: "prebuilt_projection_evidence_invalid", warnings: [error.message] };
        }
      },
    };
    const publication = await publishDraftRevision({
      publication_id: TARGET.publicationId,
      definition,
      revisions: [revision],
      revision_id: revision.revision_id,
      promotion: { evidence: evidenceResult.evidence },
      at: new Date().toISOString(),
    }, driver);
    if (!publication.success) throw new Error(`publication failed at ${publication.failed_step}: ${publication.error}`);

    const projection = await persistence.writePrebuiltExpandProjection({
      bundle_definition_id: TARGET.definitionId,
      expected_previous_projection_checksum: null,
      target_revision_id: TARGET.revisionId,
      target_projection_checksum: evidenceResult.projection.checksum,
      publication_id: TARGET.publicationId,
      projection: evidenceResult.projection,
    });
    const activeRevisionId = await persistence.readActiveRevisionId(TARGET.definitionId);
    const storedSnapshot = await persistence.readRuntimeSnapshot(TARGET.definitionId);
    const storedProjection = await persistence.readPrebuiltExpandProjection(TARGET.definitionId);
    if (activeRevisionId !== TARGET.revisionId
      || storedSnapshot?.checksum !== snapshot.checksum
      || storedProjection?.checksum !== projection.checksum) {
      throw new Error("published carrier read-back mismatch; stop and reconcile");
    }
    console.log(JSON.stringify({
      status: "published_and_verified",
      ...preflight,
      active_revision_id: activeRevisionId,
      publication_id: TARGET.publicationId,
    }, null, 2));
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
