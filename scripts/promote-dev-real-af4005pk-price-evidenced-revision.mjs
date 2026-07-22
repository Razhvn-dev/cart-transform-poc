import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createBundlePublicationPersistenceDriver } from "../extensions/master-kit-expand/src/config/bundle-publication.persistence-driver.js";
import { publishDraftRevision } from "../extensions/master-kit-expand/src/config/bundle-publication.service.js";
import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import {
  createPublicationAttempt,
  publishRevision,
  transitionPublicationAttempt,
} from "../extensions/master-kit-expand/src/config/bundle-domain.lifecycle.js";
import { buildPriceEvidencedDraftRevision } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-price-evidenced-revision.js";
import { publishPrebuiltBundleExpandProjection } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-projection.publication.js";
import {
  assertPrebuiltProjectionPublicationEvidence,
  buildPrebuiltProjectionPublicationEvidence,
} from "../extensions/master-kit-expand/src/config/prebuilt-projection-publication-evidence.js";
import {
  DEV_SHOPIFY_APP_CLIENT_ID,
  createDevShopifyPersistenceAdapter,
} from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const TARGET = Object.freeze({
  appConfig: "shopify.app.dev.toml",
  store: "huang-mvqquz1p.myshopify.com",
  apiVersion: "2026-04",
  definitionId: "4b5c384b-acc6-455d-b14a-7a1e6d433ffc",
  previousRevisionId: "e94be6f4-e08d-483b-9dcc-d80b98ee4246",
  revisionId: "7b886b43-0e58-47cb-a78d-e05930d75391",
  domainPublicationId: "3ffef588-509b-48f0-a787-76443319b71f",
  projectionPublicationId: "9cb9fc8f-b76c-4be6-bf71-c0167f1ad95c",
  createdAt: "2026-07-21T08:45:00.000Z",
  parentProductId: "gid://shopify/Product/10638462877974",
  parentVariantId: "gid://shopify/ProductVariant/51592671789334",
  componentVariantIds: Object.freeze([
    "gid://shopify/ProductVariant/51592671756566",
    "gid://shopify/ProductVariant/51592717566230",
  ]),
});
const EXPECTED_PRICES = Object.freeze({
  [TARGET.parentVariantId]: Object.freeze({ sku: "AF4005PK", cents: 55999 }),
  [TARGET.componentVariantIds[0]]: Object.freeze({ sku: "AF4005P", cents: 46999 }),
  [TARGET.componentVariantIds[1]]: Object.freeze({ sku: "AF2009P", cents: 11999 }),
});
const PILOT_SCOPE = Object.freeze({
  schema_version: "prebuilt_bundle_pilot_scope.v1",
  pilot_scope_id: TARGET.definitionId,
  store_domain: TARGET.store,
  approved_product_series_keys: Object.freeze(["real-af4005pk-demo"]),
  approved_parent_variant_gids: Object.freeze([TARGET.parentVariantId]),
});

const apply = process.argv.includes("--apply");
const confirmation = `PROMOTE:${TARGET.definitionId}:${TARGET.revisionId}`;
if (apply && !process.argv.includes(`--confirm=${confirmation}`)) {
  throw new Error(`--apply requires --confirm=${confirmation}`);
}

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "aces-dev-price-evidenced-revision-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: resolve(root, "node_modules/@shopify/cli/bin/run.js"),
  directory,
  execFileAsync: promisify(execFile),
  readOnlyAttempts: 4,
  root,
  target: TARGET,
});

try {
  const persistence = createDevShopifyPersistenceAdapter({
    appClientId: DEV_SHOPIFY_APP_CLIENT_ID,
    execute,
  });
  let state = await readState(execute);
  const prices = await readAndAssertLivePrices();
  const targetDraft = buildTargetDraft(state, prices);
  const targetSnapshot = compileRuntimeSnapshot(targetDraft.configuration);
  assertPreflightState(state, targetDraft, targetSnapshot);
  const targetEvidence = buildPrebuiltProjectionPublicationEvidence({
    definition: { ...state.definition, active_revision_id: TARGET.previousRevisionId },
    revision: targetDraft,
    revisions: [{ ...state.previousRevision, status: "published" }, targetDraft],
    snapshot: targetSnapshot,
    pilot_scope: PILOT_SCOPE,
  });

  if (!apply) {
    console.log(JSON.stringify({
      status: "read_only_ready",
      target: TARGET,
      confirmation,
      current: summarize(state),
      candidate: summarizeCandidate(targetDraft, targetSnapshot, targetEvidence.projection, prices),
    }, null, 2));
  } else {
    if (state.targetRevision === null) {
      await createTargetRevision(execute, targetDraft);
      state = await readState(execute);
    }

    if (isInterruptedDomainPublication(state, targetSnapshot)) {
      await recoverInterruptedDomainPublication(execute, state, targetSnapshot);
      state = await readState(execute);
    }

    if (state.targetRevision.status === "draft") {
      const baseDriver = createBundlePublicationPersistenceDriver({ persistence });
      const driver = {
        ...baseDriver,
        runPromotionGates: ({ snapshot, revision, promotion }) => {
          try {
            assertPrebuiltProjectionPublicationEvidence(promotion?.evidence, {
              definition: state.definition,
              revision,
              snapshot,
              projection: targetEvidence.projection,
            });
            return { ok: true, warnings: [] };
          } catch (error) {
            return { ok: false, reason: "prebuilt_projection_evidence_invalid", warnings: [error.message] };
          }
        },
      };
      const publication = await publishDraftRevision({
        publication_id: TARGET.domainPublicationId,
        definition: state.definition,
        revisions: [state.previousRevision, state.targetRevision],
        revision_id: TARGET.revisionId,
        promotion: { evidence: targetEvidence.evidence },
        at: TARGET.createdAt,
      }, driver);
      if (!publication.success) {
        throw new Error(`domain publication failed at ${publication.failed_step}: ${publication.error}`);
      }
      state = await readState(execute);
    }

    assertPublishedDomainState(state, targetSnapshot);
    if (state.projection?.published_revision_id !== TARGET.revisionId) {
      await publishPrebuiltBundleExpandProjection({
        publication_id: TARGET.projectionPublicationId,
        definition: state.definition,
        revision: state.targetRevision,
        snapshot: state.snapshot,
        fixed_selections: Object.fromEntries(state.snapshot.groups.map((group) => [group.key, group.default_option])),
        pilot_scope: PILOT_SCOPE,
        at: TARGET.createdAt,
      }, { persistence });
      state = await readState(execute);
    }

    assertComplete(state, targetSnapshot, targetEvidence.projection);
    console.log(JSON.stringify({
      status: "promoted_and_verified",
      target: TARGET,
      current: summarize(state),
      candidate: summarizeCandidate(state.targetRevision, state.snapshot, state.projection, prices),
    }, null, 2));
  }

  async function readAndAssertLivePrices() {
    const payload = await execute(`#graphql
      query ReadAf4005pkPriceEvidence($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant { id sku price product { id } }
        }
      }
    `, { variables: { ids: [TARGET.parentVariantId, ...TARGET.componentVariantIds] } });
    const variants = payload.data?.nodes ?? [];
    const byId = new Map(variants.map((variant) => [variant?.id, variant]));
    for (const [variantId, expected] of Object.entries(EXPECTED_PRICES)) {
      const variant = byId.get(variantId);
      if (variant?.sku !== expected.sku || moneyToCents(variant?.price) !== expected.cents) {
        throw new Error(`live price evidence drift for ${variantId}`);
      }
    }
    return {
      parent: priceItem(byId.get(TARGET.parentVariantId)),
      components: TARGET.componentVariantIds.map((id) => priceItem(byId.get(id))),
    };
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function readState(execute) {
  const payload = await execute(`#graphql
    query ReadAf4005pkPriceEvidencedState(
      $definitionType: String!
      $definitionHandle: String!
      $revisionType: String!
      $previousRevisionHandle: String!
      $targetRevisionHandle: String!
      $publicationType: String!
      $domainPublicationHandle: String!
      $projectionPublicationHandle: String!
      $productId: ID!
      $namespace: String!
    ) {
      definition: metaobjectByHandle(handle: { type: $definitionType, handle: $definitionHandle }) { id fields { key value jsonValue } }
      previousRevision: metaobjectByHandle(handle: { type: $revisionType, handle: $previousRevisionHandle }) { id fields { key value jsonValue } }
      targetRevision: metaobjectByHandle(handle: { type: $revisionType, handle: $targetRevisionHandle }) { id fields { key value jsonValue } }
      domainPublication: metaobjectByHandle(handle: { type: $publicationType, handle: $domainPublicationHandle }) { fields { key value jsonValue } }
      projectionPublication: metaobjectByHandle(handle: { type: $publicationType, handle: $projectionPublicationHandle }) { fields { key value jsonValue } }
      product(id: $productId) {
        snapshot: metafield(namespace: $namespace, key: "bundle_runtime_snapshot_v1") { jsonValue }
        active: metafield(namespace: $namespace, key: "active_revision_id_v1") { value }
        projection: metafield(namespace: $namespace, key: "prebuilt_bundle_expand_projection_v1") { jsonValue }
      }
    }
  `, { variables: {
    definitionType: "$app:aces_bundle_definition_dev",
    definitionHandle: TARGET.definitionId,
    revisionType: "$app:aces_bundle_revision_dev",
    previousRevisionHandle: TARGET.previousRevisionId,
    targetRevisionHandle: TARGET.revisionId,
    publicationType: "$app:aces_bundle_publication_record_dev",
    domainPublicationHandle: TARGET.domainPublicationId,
    projectionPublicationHandle: TARGET.projectionPublicationId,
    productId: TARGET.parentProductId,
    namespace: "aces_dev",
  } });
  const data = payload.data;
  return {
    definition: documentFromMetaobject(data?.definition, "BundleDefinition"),
    definitionMetaobjectId: data?.definition?.id ?? null,
    previousRevision: documentFromMetaobject(data?.previousRevision, "previous BundleRevision"),
    previousRevisionMetaobjectId: data?.previousRevision?.id ?? null,
    targetRevision: data?.targetRevision === null ? null : documentFromMetaobject(data.targetRevision, "target BundleRevision"),
    targetRevisionMetaobjectId: data?.targetRevision?.id ?? null,
    snapshot: data?.product?.snapshot?.jsonValue ?? null,
    activeRevisionId: data?.product?.active?.value ?? null,
    projection: data?.product?.projection?.jsonValue ?? null,
    domainPublication: data?.domainPublication === null ? null : documentFromMetaobject(data.domainPublication, "domain PublicationRecord"),
    projectionPublication: data?.projectionPublication === null ? null : documentFromMetaobject(data.projectionPublication, "projection PublicationRecord"),
  };
}

async function createTargetRevision(execute, revision) {
  const payload = await execute(`#graphql
    mutation CreateAf4005pkPriceEvidencedRevision($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { fields { key value jsonValue } }
        userErrors { field message code }
      }
    }
  `, { variables: { metaobject: {
    type: "$app:aces_bundle_revision_dev",
    handle: TARGET.revisionId,
    fields: [{ key: "document", value: JSON.stringify(revision) }],
  } } });
  const result = payload.data?.metaobjectCreate;
  if (result?.userErrors?.length) {
    throw new Error(`Revision create rejected: ${JSON.stringify(result.userErrors)}`);
  }
  const persisted = documentFromMetaobject(result?.metaobject, "created target BundleRevision");
  if (stableJson(persisted) !== stableJson(revision)) {
    throw new Error("Revision create mutation response mismatch");
  }
}

function documentFromMetaobject(metaobject, label) {
  const field = metaobject?.fields?.find((candidate) => candidate.key === "document");
  if (!field || field.jsonValue == null || typeof field.jsonValue !== "object") {
    throw new Error(`${label} document was not returned by Shopify`);
  }
  return field.jsonValue;
}

function buildTargetDraft(state, prices) {
  if (state.targetRevision !== null) {
    return {
      ...structuredClone(state.targetRevision),
      status: "draft",
      runtime_snapshot_ref: null,
    };
  }
  if (state.previousRevision === null) throw new Error("previous published Revision was not found");
  return buildPriceEvidencedDraftRevision({
    publishedRevision: state.previousRevision,
    revisionId: TARGET.revisionId,
    createdAt: TARGET.createdAt,
    createdBy: TARGET.store,
    storeDomain: TARGET.store,
    parent: prices.parent,
    components: prices.components,
  });
}

function assertPreflightState(state, targetDraft, targetSnapshot) {
  if (state.previousRevision?.revision_number !== 1 || !["published", "superseded"].includes(state.previousRevision.status)) {
    throw new Error("previous Revision state is not recoverable");
  }
  const interrupted = isInterruptedDomainPublication(state, targetSnapshot);
  if (!interrupted && (![TARGET.previousRevisionId, TARGET.revisionId].includes(state.definition.active_revision_id)
    || ![TARGET.previousRevisionId, TARGET.revisionId].includes(state.activeRevisionId)
    || state.definition.active_revision_id !== state.activeRevisionId)) {
    throw new Error(`active Revision pointer drift: ${JSON.stringify(summarize(state))}`);
  }
  if (state.targetRevision !== null && state.targetRevision.status === "draft"
    && stableJson(state.targetRevision) !== stableJson(targetDraft)) {
    throw new Error("existing target draft differs from the price-evidenced candidate");
  }
  if (state.targetRevision !== null && !["draft", "published"].includes(state.targetRevision.status)) {
    throw new Error("target Revision is in an unsupported state");
  }
}

function isInterruptedDomainPublication(state, targetSnapshot) {
  return state.targetRevision !== null
    && state.activeRevisionId === TARGET.revisionId
    && state.snapshot?.checksum === targetSnapshot.checksum
    && state.domainPublication === null
    && [TARGET.previousRevisionId, TARGET.revisionId].includes(state.definition.active_revision_id)
    && ["published", "superseded"].includes(state.previousRevision?.status)
    && ["draft", "published"].includes(state.targetRevision?.status);
}

async function recoverInterruptedDomainPublication(execute, state, targetSnapshot) {
  const draft = state.targetRevision.status === "draft"
    ? state.targetRevision
    : { ...state.targetRevision, status: "draft", runtime_snapshot_ref: null };
  const previous = state.previousRevision.status === "published"
    ? state.previousRevision
    : { ...state.previousRevision, status: "published" };
  const baseDefinition = {
    ...state.definition,
    active_revision_id: TARGET.previousRevisionId,
  };
  const domain = publishRevision({
    definition: baseDefinition,
    revisions: [previous, draft],
    revisionId: TARGET.revisionId,
    runtimeSnapshotRef: snapshotReference(targetSnapshot),
    updatedAt: TARGET.createdAt,
  });

  if (!domainDocumentsMatch(state, domain)) {
    for (const [label, id] of [
      ["Definition", state.definitionMetaobjectId],
      ["previous Revision", state.previousRevisionMetaobjectId],
      ["target Revision", state.targetRevisionMetaobjectId],
    ]) {
      if (typeof id !== "string") throw new Error(`${label} Metaobject ID is missing`);
    }
    const targetRevision = domain.revisions.find((revision) => revision.revision_id === TARGET.revisionId);
    const previousRevision = domain.revisions.find((revision) => revision.revision_id === TARGET.previousRevisionId);
    const payload = await execute(`#graphql
      mutation RecoverAf4005pkPriceEvidencedDomain(
        $definitionId: ID!
        $previousRevisionId: ID!
        $targetRevisionId: ID!
        $definition: MetaobjectUpdateInput!
        $previousRevision: MetaobjectUpdateInput!
        $targetRevision: MetaobjectUpdateInput!
      ) {
        definition: metaobjectUpdate(id: $definitionId, metaobject: $definition) { metaobject { fields { key value jsonValue } } userErrors { field message code } }
        previousRevision: metaobjectUpdate(id: $previousRevisionId, metaobject: $previousRevision) { metaobject { fields { key value jsonValue } } userErrors { field message code } }
        targetRevision: metaobjectUpdate(id: $targetRevisionId, metaobject: $targetRevision) { metaobject { fields { key value jsonValue } } userErrors { field message code } }
      }
    `, { variables: {
      definitionId: state.definitionMetaobjectId,
      previousRevisionId: state.previousRevisionMetaobjectId,
      targetRevisionId: state.targetRevisionMetaobjectId,
      definition: documentUpdate(domain.definition),
      previousRevision: documentUpdate(previousRevision),
      targetRevision: documentUpdate(targetRevision),
    } });
    for (const [key, expected] of [
      ["definition", domain.definition],
      ["previousRevision", previousRevision],
      ["targetRevision", targetRevision],
    ]) {
      const result = payload.data?.[key];
      if (result?.userErrors?.length) throw new Error(`${key} recovery rejected: ${JSON.stringify(result.userErrors)}`);
      if (stableJson(documentFromMetaobject(result?.metaobject, `${key} recovery`)) !== stableJson(expected)) {
        throw new Error(`${key} recovery mutation response mismatch`);
      }
    }
  }

  const auditState = { ...state, definition: domain.definition, previousRevision: domain.revisions.find((revision) => revision.revision_id === TARGET.previousRevisionId), targetRevision: domain.revisions.find((revision) => revision.revision_id === TARGET.revisionId) };
  await createDomainRecoveryAudit(execute, auditState, targetSnapshot);
}

async function createDomainRecoveryAudit(execute, state, snapshot) {
  let attempt = createPublicationAttempt({
    publicationId: TARGET.domainPublicationId,
    revision: { ...state.targetRevision, status: "draft", runtime_snapshot_ref: null },
    runtimeSnapshotRef: snapshotReference(snapshot),
    previousActiveRevisionId: TARGET.previousRevisionId,
    attemptNumber: 1,
    createdAt: TARGET.createdAt,
  });
  for (const transition of ["compiled", "snapshot_written", "snapshot_verified", "active_pointer_updated", "recorded"]) {
    attempt = transitionPublicationAttempt(attempt, transition, TARGET.createdAt);
  }
  const domain = { definition: state.definition, revisions: [state.previousRevision, state.targetRevision] };
  const result = {
    success: true,
    publication_id: TARGET.domainPublicationId,
    completed_steps: [
      "normalized_validated", "snapshot_compiled", "checksum_size_gates", "promotion_parity_gates",
      "external_pointer_preflight", "previous_snapshot_read", "snapshot_written", "readback_verified",
      "active_pointer_updated", "previous_revision_superseded", "domain_persisted", "publication_recorded",
    ],
    failed_step: null,
    compensation: { attempted: false, success: true, steps: [] },
    previous_active_revision_id: TARGET.previousRevisionId,
    active_revision_id: TARGET.revisionId,
    snapshot_checksum: snapshot.checksum,
    warnings: ["recovered_from_interrupted_domain_publication"],
    domain,
    publication_attempt: attempt,
  };
  const record = { publication_attempt: attempt, result, domain };
  const payload = await execute(`#graphql
    mutation CreateAf4005pkDomainRecoveryAudit($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { fields { key value jsonValue } }
        userErrors { field message code }
      }
    }
  `, { variables: { metaobject: {
    type: "$app:aces_bundle_publication_record_dev",
    handle: TARGET.domainPublicationId,
    fields: [{ key: "document", value: JSON.stringify(record) }],
  } } });
  const auditResult = payload.data?.metaobjectCreate;
  if (auditResult?.userErrors?.length) throw new Error(`domain recovery audit rejected: ${JSON.stringify(auditResult.userErrors)}`);
  if (stableJson(documentFromMetaobject(auditResult?.metaobject, "domain recovery audit")) !== stableJson(record)) {
    throw new Error("domain recovery audit mutation response mismatch");
  }
}

function domainDocumentsMatch(state, domain) {
  const target = domain.revisions.find((revision) => revision.revision_id === TARGET.revisionId);
  const previous = domain.revisions.find((revision) => revision.revision_id === TARGET.previousRevisionId);
  return stableJson(state.definition) === stableJson(domain.definition)
    && stableJson(state.targetRevision) === stableJson(target)
    && stableJson(state.previousRevision) === stableJson(previous);
}

function documentUpdate(document) {
  return { fields: [{ key: "document", value: JSON.stringify(document) }] };
}

function snapshotReference(snapshot) {
  return {
    schema_version: snapshot.snapshot_schema,
    checksum_algorithm: snapshot.checksum_algorithm,
    checksum: snapshot.checksum,
    configuration_version: snapshot.configuration_version,
  };
}

function assertPublishedDomainState(state, snapshot) {
  if (state.definition.active_revision_id !== TARGET.revisionId
    || state.activeRevisionId !== TARGET.revisionId
    || state.targetRevision?.status !== "published"
    || state.previousRevision?.status !== "superseded"
    || state.snapshot?.checksum !== snapshot.checksum
    || state.domainPublication?.result?.success !== true) {
    throw new Error("price-evidenced domain publication read-back mismatch");
  }
}

function assertComplete(state, snapshot, projection) {
  assertPublishedDomainState(state, snapshot);
  if (state.projection?.checksum !== projection.checksum
    || state.projection?.published_revision_id !== TARGET.revisionId
    || state.projectionPublication?.result?.success !== true) {
    throw new Error("price-evidenced Projection publication read-back mismatch");
  }
}

function summarize(state) {
  return {
    active_revision_id: state.activeRevisionId,
    previous_revision_status: state.previousRevision?.status ?? null,
    target_revision_status: state.targetRevision?.status ?? null,
    snapshot_checksum: state.snapshot?.checksum ?? null,
    projection_checksum: state.projection?.checksum ?? null,
    projection_revision_id: state.projection?.published_revision_id ?? null,
    domain_publication_exists: state.domainPublication !== null,
    projection_publication_exists: state.projectionPublication !== null,
  };
}

function summarizeCandidate(revision, snapshot, projection, prices) {
  return {
    revision_id: revision.revision_id,
    revision_number: revision.revision_number,
    price_evidence_checksum: revision.configuration.pricing.price_evidence.checksum,
    live_parent_price: centsToMoney(prices.parent.variant_price_cents),
    live_component_subtotal: centsToMoney(prices.components.reduce((total, item) => total + item.variant_price_cents, 0)),
    allocated_components: projection.components.map((component) => ({
      sku: component.sku,
      fixed_price_per_unit: component.fixed_price_per_unit,
    })),
    allocated_total: centsToMoney(projection.components.reduce(
      (total, component) => total + moneyToCents(component.fixed_price_per_unit),
      0,
    )),
    snapshot_checksum: snapshot.checksum,
    projection_checksum: projection.checksum,
  };
}

function priceItem(variant) {
  return {
    variant_gid: variant.id,
    sku: variant.sku,
    variant_price_cents: moneyToCents(variant.price),
  };
}

function moneyToCents(value) {
  if (!/^\d+\.\d{2}$/.test(value ?? "")) throw new Error(`invalid Shopify money value ${value}`);
  const [whole, fraction] = value.split(".");
  const cents = (Number(whole) * 100) + Number(fraction);
  if (!Number.isSafeInteger(cents)) throw new Error("Shopify money value exceeds safe integer precision");
  return cents;
}

function centsToMoney(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
