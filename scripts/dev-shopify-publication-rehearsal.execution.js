import { masterKitConfigV1 } from "../extensions/master-kit-expand/src/config/fixtures/master-kit-config.v1.js";
import { UUID_REGEX } from "../extensions/master-kit-expand/src/config/bundle-config.schema.js";

import {
  DEV_PUBLICATION_REHEARSAL_BINDINGS,
  assertDevPublicationRehearsalPlan,
  createDevPublicationRehearsalPlan,
} from "./dev-shopify-publication-rehearsal.js";

export const DEV_PUBLICATION_REHEARSAL_RUN_ID = "e9011d4e-5a14-4e0d-9000-000000000000";
export const DEV_PUBLICATION_REHEARSAL_AT = "2026-07-17T00:00:00.000Z";

export function createDevPublicationRehearsalExecution(runId = DEV_PUBLICATION_REHEARSAL_RUN_ID) {
  if (typeof runId !== "string" || !UUID_REGEX.test(runId) || !runId.endsWith("0")) {
    throw new Error("rehearsal run_id must be a UUID ending in 0");
  }

  const identifiers = Object.freeze({
    bundleDefinitionId: runId,
    baselineRevisionId: replaceLastCharacter(runId, "1"),
    candidateRevisionId: replaceLastCharacter(runId, "2"),
    baselinePublicationId: replaceLastCharacter(runId, "3"),
    candidatePublicationId: replaceLastCharacter(runId, "4"),
    rollbackPublicationId: replaceLastCharacter(runId, "5"),
  });
  const baselineConfiguration = configuration(identifiers.bundleDefinitionId, 1);
  const candidateConfiguration = configuration(identifiers.bundleDefinitionId, 2);
  const plan = createDevPublicationRehearsalPlan({
    runId: identifiers.bundleDefinitionId,
    baselineRevisionId: identifiers.baselineRevisionId,
    candidateRevisionId: identifiers.candidateRevisionId,
    baselinePublicationId: identifiers.baselinePublicationId,
    candidatePublicationId: identifiers.candidatePublicationId,
    baselineConfiguration,
    candidateConfiguration,
  });
  assertDevPublicationRehearsalPlan(plan);

  return Object.freeze({
    identifiers,
    plan,
    definition: {
      schema_version: "bundle_definition.v1",
      bundle_definition_id: identifiers.bundleDefinitionId,
      slug: `aces-publication-rehearsal-${runId.slice(0, 8)}`,
      parent_binding: {
        product_gid: masterKitConfigV1.parent.product_gid,
        variant_gid: masterKitConfigV1.parent.variant_gid,
      },
      active_revision_id: null,
      created_at: DEV_PUBLICATION_REHEARSAL_AT,
      updated_at: DEV_PUBLICATION_REHEARSAL_AT,
    },
    baselineRevision: revision({
      revisionId: identifiers.baselineRevisionId,
      bundleDefinitionId: identifiers.bundleDefinitionId,
      revisionNumber: 1,
      configuration: baselineConfiguration,
    }),
    candidateRevision: revision({
      revisionId: identifiers.candidateRevisionId,
      bundleDefinitionId: identifiers.bundleDefinitionId,
      revisionNumber: 2,
      configuration: candidateConfiguration,
    }),
  });
}

export function assertRehearsalOperationIsolated(query) {
  const forbidden = [
    "bundle_runtime_snapshot_v1",
    "active_revision_id_v1",
    "bundle_runtime_snapshot_test",
    "cart-transform-poc\"",
  ];
  const source = typeof query === "string" ? query : JSON.stringify(query);
  const match = forbidden.find((token) => source.includes(token));
  if (match) throw new Error(`rehearsal operation contains forbidden token: ${match}`);
  return query;
}

export function buildStaleRehearsalSnapshotCasMutation() {
  const query = `#graphql
    mutation DevPublicationRehearsalStaleSnapshotCas($metafields: [MetafieldsSetInput!]!) {
      staleWrite: metafieldsSet(metafields: $metafields) {
        metafields { key value compareDigest }
        userErrors { code message }
      }
    }
  `;
  return assertRehearsalOperationIsolated(query);
}

export function buildDevPublicationRehearsalReconciliationQuery(runId = DEV_PUBLICATION_REHEARSAL_RUN_ID) {
  const { identifiers } = createDevPublicationRehearsalExecution(runId);
  return assertRehearsalOperationIsolated(`#graphql
    query DevPublicationRehearsalReconciliation {
      definition: metaobjectByHandle(handle: { type: "$app:aces_bundle_definition_dev", handle: "${identifiers.bundleDefinitionId}" }) {
        id type handle fields { key value jsonValue }
      }
      baselineRevision: metaobjectByHandle(handle: { type: "$app:aces_bundle_revision_dev", handle: "${identifiers.baselineRevisionId}" }) {
        id type handle fields { key value jsonValue }
      }
      candidateRevision: metaobjectByHandle(handle: { type: "$app:aces_bundle_revision_dev", handle: "${identifiers.candidateRevisionId}" }) {
        id type handle fields { key value jsonValue }
      }
      baselinePublication: metaobjectByHandle(handle: { type: "$app:aces_bundle_publication_record_dev", handle: "${identifiers.baselinePublicationId}" }) {
        id type handle fields { key value jsonValue }
      }
      candidatePublication: metaobjectByHandle(handle: { type: "$app:aces_bundle_publication_record_dev", handle: "${identifiers.candidatePublicationId}" }) {
        id type handle fields { key value jsonValue }
      }
      rollbackPublication: metaobjectByHandle(handle: { type: "$app:aces_bundle_publication_record_dev", handle: "${identifiers.rollbackPublicationId}" }) {
        id type handle fields { key value jsonValue }
      }
      product(id: "${masterKitConfigV1.parent.product_gid}") {
        snapshot: metafield(namespace: "aces_dev", key: "${DEV_PUBLICATION_REHEARSAL_BINDINGS.runtimeSnapshotKey}") {
          value jsonValue compareDigest
        }
        activeRevision: metafield(namespace: "aces_dev", key: "${DEV_PUBLICATION_REHEARSAL_BINDINGS.activeRevisionKey}") {
          value compareDigest
        }
      }
    }
  `);
}

export function summarizeDevPublicationRehearsalReconciliation(remote) {
  return {
    definition_active_revision_id: document(remote.definition)?.active_revision_id ?? null,
    baseline_revision_status: document(remote.baselineRevision)?.status ?? null,
    baseline_publication_exists: remote.baselinePublication !== null,
    candidate_revision_exists: remote.candidateRevision !== null,
    candidate_publication_exists: remote.candidatePublication !== null,
    rollback_publication_exists: remote.rollbackPublication !== null,
    snapshot_checksum: remote.product?.snapshot?.jsonValue?.checksum ?? null,
    snapshot_compare_digest: remote.product?.snapshot?.compareDigest ?? null,
    active_pointer: remote.product?.activeRevision?.value ?? null,
    active_pointer_compare_digest: remote.product?.activeRevision?.compareDigest ?? null,
  };
}

function configuration(bundleDefinitionId, version) {
  const result = structuredClone(masterKitConfigV1);
  result.configuration_id = bundleDefinitionId;
  result.configuration_version = version;
  result.status = "draft";
  result.revision = {
    ...result.revision,
    draft_revision: version,
    published_revision: Math.max(1, version - 1),
  };
  return result;
}

function revision({ revisionId, bundleDefinitionId, revisionNumber, configuration }) {
  return {
    schema_version: "bundle_revision.v1",
    revision_id: revisionId,
    bundle_definition_id: bundleDefinitionId,
    revision_number: revisionNumber,
    status: "draft",
    configuration,
    runtime_snapshot_ref: null,
    created_at: DEV_PUBLICATION_REHEARSAL_AT,
    updated_at: DEV_PUBLICATION_REHEARSAL_AT,
    created_by: "dev-publication-rehearsal",
  };
}

function replaceLastCharacter(value, replacement) {
  return `${value.slice(0, -1)}${replacement}`;
}

function document(metaobject) {
  const field = metaobject?.fields?.find((candidate) => candidate.key === "document");
  return field?.jsonValue ?? null;
}
