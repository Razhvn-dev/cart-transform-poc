import { randomUUID } from "node:crypto";
import { createInMemoryBundlePersistenceAdapter } from "../../../extensions/master-kit-expand/src/config/bundle-persistence.in-memory-adapter.js";
import { publishDraftRevision } from "../../../extensions/master-kit-expand/src/config/bundle-publication.service.js";
import { createInMemoryBundleAdminRepository } from "./bundle-admin.in-memory-repository.js";
import { createBundleAdminService } from "./bundle-admin.service.js";

let service;

// Phase 5.1 deliberately keeps this process-local. Replacing it with the
// Shopify persistence adapter is a later explicit integration step.
export function getLocalBundleAdminService() {
  if (service) return service;

  const persistence = createInMemoryBundlePersistenceAdapter();
  service = createBundleAdminService({
    persistence,
    repository: createInMemoryBundleAdminRepository({ persistence }),
    publicationService: publishDraftRevision,
    idFactory: randomUUID,
  });
  return service;
}
