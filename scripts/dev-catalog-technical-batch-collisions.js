export function assessDevCatalogTechnicalBatchCollisions({ drafts, liveReadback, definitions } = {}) {
  const definitionById = new Map(definitions.map((definition) => [definition.bundle_definition_id, definition]));
  const definitionsByParent = new Map();
  for (const definition of definitions) {
    const parent = definition.parent_binding?.variant_gid;
    if (!parent) continue;
    definitionsByParent.set(parent, [...(definitionsByParent.get(parent) ?? []), definition]);
  }
  const liveBySku = new Map(liveReadback.records.map((record) => [record.parent_sku, record]));
  const records = drafts.records.map((record) => {
    const parentVariantGid = record.draft?.definition.parent_binding.variant_gid
      ?? liveBySku.get(record.parent_sku)?.parent?.live?.variant_gid ?? null;
    const owners = definitionsByParent.get(parentVariantGid) ?? [];
    const issues = [];
    if (record.status === "draft_ready" && definitionById.has(record.draft.definition.bundle_definition_id)) issues.push("PROPOSED_DEFINITION_ID_EXISTS");
    if (record.status === "draft_ready" && owners.length > 0) issues.push("PARENT_VARIANT_ALREADY_OWNED");
    if (record.status === "existing_binding" && owners.length !== 1) issues.push("EXISTING_BINDING_NOT_UNIQUE");
    return {
      parent_sku: record.parent_sku,
      source_status: record.status,
      status: issues.length === 0 ? (record.status === "existing_binding" ? "existing_binding_verified" : "collision_free") : "blocked",
      proposed_definition_id: record.draft?.definition.bundle_definition_id ?? null,
      parent_variant_gid: parentVariantGid,
      existing_owners: owners.map((owner) => ({ bundle_definition_id: owner.bundle_definition_id, slug: owner.slug, active_revision_id: owner.active_revision_id })),
      issues,
    };
  });
  return {
    schema_version: "dev_catalog_technical_batch_collision_readback.v1",
    mode: "shopify_admin_read_only",
    batch_id: drafts.batch_id,
    scanned_definition_count: definitions.length,
    summary: records.reduce((result, record) => {
      result.total += 1;
      result[record.status] += 1;
      return result;
    }, { total: 0, collision_free: 0, existing_binding_verified: 0, blocked: 0 }),
    records,
    shopify_writes_performed: false,
  };
}
