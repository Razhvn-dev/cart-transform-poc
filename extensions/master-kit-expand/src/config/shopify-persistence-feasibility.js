export const SHOPIFY_PERSISTENCE_FEASIBILITY_V1 = Object.freeze({
  bundleDefinition: {
    candidates: ["app_owned_metaobject", "app_backend_database"],
    recommended: "app_owned_metaobject",
    reason: "Stable editable configuration identity with structured fields and Admin visibility.",
  },
  bundleRevision: {
    candidates: ["app_owned_metaobject", "app_backend_database"],
    recommended: "app_owned_metaobject",
    reason: "Immutable revision documents and history are a natural Metaobject record shape.",
  },
  runtimeSnapshot: {
    candidates: ["parent_product_app_owned_json_metafield"],
    recommended: "parent_product_app_owned_json_metafield",
    reason: "The accepted Runtime Snapshot V1 is read from the parent product by Cart Transform input.",
  },
  activeRevisionPointer: {
    candidates: ["parent_product_app_owned_json_metafield", "bundle_definition_metaobject_field"],
    recommended: "parent_product_app_owned_json_metafield",
    reason: "Metafield compareDigest provides the required active_revision_id CAS primitive.",
  },
  publicationRecord: {
    candidates: ["app_owned_metaobject", "app_backend_database"],
    recommended: "app_owned_metaobject",
    reason: "Append-only audit records can use a publication_id handle for lookup; stricter operations may require an app database.",
  },
  capabilities: {
    metafieldsSet: { compare_and_set: true, atomic_within_mutation: true },
    metaobjectUpdate: { compare_and_set: false, atomic_with_metafields: false },
    cross_resource_transaction: false,
  },
  compensationRequiredFor: [
    "snapshot write followed by read-back verification",
    "pointer change after Snapshot write",
    "publication record failure after pointer change",
    "all Metaobject plus Metafield multi-resource publication flows",
  ],
});

export function validateShopifyPersistenceFeasibility(feasibility = SHOPIFY_PERSISTENCE_FEASIBILITY_V1) {
  const errors = [];
  if (feasibility.runtimeSnapshot?.recommended !== "parent_product_app_owned_json_metafield") {
    errors.push("Runtime Snapshot must remain on a parent-product app-owned JSON metafield");
  }
  if (!feasibility.capabilities?.metafieldsSet?.compare_and_set) {
    errors.push("metafieldsSet compare-and-set capability is required for active revision CAS");
  }
  if (feasibility.capabilities?.cross_resource_transaction) {
    errors.push("Shopify cross-resource transaction support must not be assumed");
  }
  if (!Array.isArray(feasibility.compensationRequiredFor) || feasibility.compensationRequiredFor.length === 0) {
    errors.push("compensation boundaries must be documented");
  }
  return errors;
}
