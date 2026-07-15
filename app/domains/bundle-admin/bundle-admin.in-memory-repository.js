import { BundlePersistenceError } from "../../../extensions/master-kit-expand/src/config/bundle-persistence.adapter.js";

// Local-only query view for the in-memory adapter. A future Shopify adapter will
// provide the same query port without exposing its internal storage.
export function createInMemoryBundleAdminRepository({ persistence }) {
  const state = persistence?.state;
  if (!(state?.definitionStore instanceof Map) || !(state?.revisionStore instanceof Map)) {
    throw new BundlePersistenceError(
      "UNSUPPORTED_CAPABILITY",
      "the supplied persistence adapter does not expose the in-memory query state",
    );
  }

  return {
    listBundleDefinitions() {
      return Array.from(state.definitionStore.values(), clone);
    },
    listRevisionsByDefinition(bundleDefinitionId) {
      return Array.from(state.revisionStore.values())
        .filter((revision) => revision.bundle_definition_id === bundleDefinitionId)
        .map(clone);
    },
  };
}

function clone(value) {
  return structuredClone(value);
}
