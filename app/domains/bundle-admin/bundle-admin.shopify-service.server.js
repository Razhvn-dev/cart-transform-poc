import { randomUUID } from "node:crypto";
import {
  DEV_SHOPIFY_APP_CLIENT_ID,
  createDevShopifyPersistenceAdapter,
} from "../../../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import { publishDraftRevision } from "../../../extensions/master-kit-expand/src/config/bundle-publication.service.js";
import { createBundleAdminService } from "./bundle-admin.service.js";

export function createDevShopifyBundleAdminService({ admin, appClientId = process.env.SHOPIFY_API_KEY }) {
  if (typeof admin?.graphql !== "function") {
    throw new TypeError("an authenticated Shopify Admin GraphQL client is required");
  }

  const persistence = createDevShopifyPersistenceAdapter({
    appClientId,
    execute: (query, options) => admin.graphql(query, options),
  });

  return createBundleAdminService({
    persistence,
    repository: {
      listBundleDefinitions: () => persistence.listBundleDefinitions(),
      listRevisionsByDefinition: (bundleDefinitionId) => persistence.listRevisionsByDefinition(bundleDefinitionId),
    },
    publicationService: publishDraftRevision,
    idFactory: randomUUID,
  });
}

export { DEV_SHOPIFY_APP_CLIENT_ID };
