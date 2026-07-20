import { randomUUID } from "node:crypto";
import {
  DEV_SHOPIFY_APP_CLIENT_ID,
  DEV_SHOPIFY_PERSISTENCE_BINDINGS,
  createDevShopifyPersistenceAdapter,
} from "../../../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import { createBundlePublicationPersistenceDriver } from "../../../extensions/master-kit-expand/src/config/bundle-publication.persistence-driver.js";
import { publishDraftRevision, rollbackPublishedRevision } from "../../../extensions/master-kit-expand/src/config/bundle-publication.service.js";
import { executeConfirmedPrebuiltBundleImport } from "../../../extensions/master-kit-expand/src/config/prebuilt-bundle-import.execution.js";
import { createShopifyPrebuiltBundleImportLedger } from "../../../extensions/master-kit-expand/src/config/prebuilt-bundle-import.shopify-ledger.js";
import { createPrebuiltBundleImportTargetWriter } from "../../../extensions/master-kit-expand/src/config/prebuilt-bundle-import.target-persistence.js";
import { createFilePublicationPromotionEvidenceProvider } from "./bundle-admin.promotion-evidence.server.js";
import { createBundleAdminService } from "./bundle-admin.service.js";

export function createDevShopifyBundleAdminService({
  admin,
  appClientId = process.env.SHOPIFY_API_KEY,
  publicationEnabled = process.env.BUNDLE_ADMIN_PUBLICATION_ENABLED === "true",
  publicationEvidenceDirectory = process.env.BUNDLE_ADMIN_PROMOTION_EVIDENCE_DIRECTORY,
  prebuiltImportExecutionEnabled = process.env.BUNDLE_ADMIN_PREBUILT_IMPORT_EXECUTION_ENABLED === "true",
  persistenceBindings = DEV_SHOPIFY_PERSISTENCE_BINDINGS,
} = {}) {
  if (typeof admin?.graphql !== "function") {
    throw new TypeError("an authenticated Shopify Admin GraphQL client is required");
  }

  const persistence = createDevShopifyPersistenceAdapter({
    appClientId,
    bindings: persistenceBindings,
    execute: (query, options) => admin.graphql(query, options),
  });
  const publication = createPublicationComposition({
    persistence,
    publicationEnabled,
    publicationEvidenceDirectory,
  });
  const prebuiltImport = createPrebuiltImportComposition({
    persistence,
    enabled: prebuiltImportExecutionEnabled,
  });

  return createBundleAdminService({
    persistence,
    repository: {
      listBundleDefinitions: () => persistence.listBundleDefinitions(),
      listRevisionsByDefinition: (bundleDefinitionId) => persistence.listRevisionsByDefinition(bundleDefinitionId),
      listPublicationRecordsByDefinition: (bundleDefinitionId) => persistence.listPublicationRecordsByDefinition(bundleDefinitionId),
    },
    publicationService: publishDraftRevision,
    rollbackService: rollbackPublishedRevision,
    publicationDriver: publication.driver,
    publicationEnabled: publication.enabled,
    prebuiltImportExecutionEnabled: prebuiltImport.enabled,
    prebuiltImportExecutor: prebuiltImport.executor,
    prebuiltImportLedger: prebuiltImport.ledger,
    createPrebuiltImportTargetWriter: prebuiltImport.createTargetWriter,
    resolvePromotionEvidence: publication.resolvePromotionEvidence,
    idFactory: randomUUID,
  });
}

export { DEV_SHOPIFY_APP_CLIENT_ID };

function createPublicationComposition({ persistence, publicationEnabled, publicationEvidenceDirectory }) {
  // Publishing is fail-closed: the process-level opt-in and a server-owned
  // evidence directory must both be present before a route can write Shopify.
  if (!publicationEnabled || typeof publicationEvidenceDirectory !== "string" || publicationEvidenceDirectory.trim() === "") {
    return { enabled: false, driver: null, resolvePromotionEvidence: null };
  }

  const evidence = createFilePublicationPromotionEvidenceProvider({
    evidenceDirectory: publicationEvidenceDirectory,
  });
  return {
    enabled: true,
    driver: createBundlePublicationPersistenceDriver({ persistence }),
    resolvePromotionEvidence: evidence.resolvePromotionEvidence,
  };
}

export function createPrebuiltImportComposition({ persistence, enabled }) {
  if (!enabled) {
    return { enabled: false, executor: null, ledger: null, createTargetWriter: null };
  }
  const ledger = createShopifyPrebuiltBundleImportLedger({ persistence });
  return {
    enabled: true,
    executor: executeConfirmedPrebuiltBundleImport,
    ledger,
    createTargetWriter: ({ pilot_scope: pilotScope }) => createPrebuiltBundleImportTargetWriter({
      persistence,
      pilot_scope: pilotScope,
      id_factory: () => randomUUID(),
      created_by: "bundle-admin-prebuilt-import",
    }),
  };
}
