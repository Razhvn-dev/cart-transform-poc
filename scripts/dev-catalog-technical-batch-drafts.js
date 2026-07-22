import { createHash } from "node:crypto";

import { assertValidBundleConfig } from "../extensions/master-kit-expand/src/config/bundle-config.validator.js";
import { parseBundleDefinition, parseBundleRevision } from "../extensions/master-kit-expand/src/config/bundle-domain.parser.js";
import { compileRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { calculateStableValueChecksum } from "../extensions/master-kit-expand/src/config/bundle-runtime.checksum.js";

export const DEV_CATALOG_TECHNICAL_BATCH_DRAFTS_SCHEMA_VERSION = "dev_catalog_technical_batch_drafts.v1";

export function prepareDevCatalogTechnicalBatchDrafts({ catalogReport, readinessReport, liveReadback, scope } = {}) {
  assertBatchInputs(readinessReport, liveReadback, scope);
  const candidateBySku = new Map(catalogReport.candidates.map((candidate) => [candidate.parent_sku, candidate]));
  const readinessBySku = new Map(readinessReport.records.map((record) => [record.parent_sku, record]));
  const liveBySku = new Map(liveReadback.records.map((record) => [record.parent_sku, record]));
  const existingParentSkus = new Set(scope.existing_parent_skus ?? []);
  const records = scope.parent_skus.map((parentSku) => {
    if (existingParentSkus.has(parentSku)) {
      return { parent_sku: parentSku, status: "existing_binding", draft: null, issues: [] };
    }
    const candidate = candidateBySku.get(parentSku);
    const readiness = readinessBySku.get(parentSku);
    const live = liveBySku.get(parentSku);
    const errors = [
      ...(!candidate ? ["CANDIDATE_NOT_FOUND"] : []),
      ...(!readiness || readiness.status === "blocked" ? ["LOCAL_READINESS_BLOCKED"] : []),
      ...(!live || live.status === "blocked" ? ["LIVE_READBACK_BLOCKED"] : []),
    ];
    if (errors.length > 0) return { parent_sku: parentSku, status: "blocked", draft: null, issues: errors };
    const draft = buildDraft({ candidate, readiness, live, scope });
    return { parent_sku: parentSku, status: "draft_ready", draft, issues: [] };
  });
  const body = {
    schema_version: DEV_CATALOG_TECHNICAL_BATCH_DRAFTS_SCHEMA_VERSION,
    mode: "local_draft_only",
    batch_id: scope.batch_id,
    created_at: scope.draft_created_at,
    summary: records.reduce((summary, record) => {
      summary.total += 1;
      summary[record.status] += 1;
      return summary;
    }, { total: 0, draft_ready: 0, existing_binding: 0, blocked: 0 }),
    records,
    requires_product_series_assignment: true,
    requires_collision_readback: true,
    shopify_writes_performed: false,
  };
  return { ...body, checksum: calculateStableValueChecksum(body) };
}

function buildDraft({ candidate, readiness, live, scope }) {
  const definitionId = stableUuid(`${scope.batch_id}:${candidate.parent_sku}:definition`);
  const revisionId = stableUuid(`${scope.batch_id}:${candidate.parent_sku}:revision:1`);
  const slug = `dev-${candidate.parent_sku.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const groups = candidate.components.map((component, index) => {
    const liveComponent = live.components.find((item) => item.sku === component.sku);
    const allocated = readiness.evidence.components.find((item) => item.sku === component.sku);
    const suffix = component.sku.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const groupKey = `component_${String(index + 1).padStart(2, "0")}_${suffix}`;
    const optionKey = `fixed_${suffix}`;
    return {
      group_key: groupKey,
      slot: groupKey,
      label: component.product_title || component.variant_title || component.sku,
      role: "fixed_component",
      display_order: (index + 1) * 10,
      required: true,
      min: 1,
      max: 1,
      ui_type: "select",
      cart_attribute: `_prebuilt_${groupKey}`,
      default_option_key: optionKey,
      help_text: "",
      image_behavior: "product_featured_media",
      options: [{
        option_key: optionKey,
        product_gid: liveComponent.live.product_gid,
        variant_gid: liveComponent.live.variant_gid,
        sku: component.sku,
        label: component.product_title || component.variant_title || component.sku,
        active: true,
        sort_order: 10,
        price_cents_snapshot: allocated.allocated_price_cents,
        price_source: "shopify_parent_price_proportional_allocation",
        metadata_role: "fixed_component",
        effective_from: scope.draft_created_at,
        effective_to: null,
      }],
    };
  });
  const selections = Object.fromEntries(groups.map((group) => [group.group_key, group.default_option_key]));
  const lockedSelections = groups.map((group) => ({ group_key: group.group_key, option_key: group.default_option_key }));
  const priceEvidenceBody = {
    schema_version: "prebuilt_bundle_price_evidence.v1",
    store_domain: liveReadbackStore(live),
    captured_at: scope.draft_created_at,
    parent: {
      variant_gid: live.parent.live.variant_gid,
      sku: candidate.parent_sku,
      variant_price_cents: readiness.evidence.parent_price_cents,
    },
    component_subtotal_cents: readiness.evidence.component_subtotal_cents,
    bundle_price_cents: readiness.evidence.parent_price_cents,
    discount_cents: readiness.evidence.discount_cents,
    allocation_method: "proportional_to_variant_price_with_delta_to_last",
    components: groups.map((group, index) => ({
      variant_gid: group.options[0].variant_gid,
      sku: group.options[0].sku,
      variant_price_cents: readiness.evidence.components[index].variant_price_cents,
      allocated_price_cents: group.options[0].price_cents_snapshot,
    })),
    allocation_total_cents: readiness.evidence.allocation_total_cents,
  };
  const configuration = {
    schema_version: "bundle_config.v1",
    configuration_id: definitionId,
    slug,
    configuration_version: 1,
    status: "draft",
    effective_from: scope.draft_created_at,
    effective_to: null,
    internal_name: `Development technical draft - ${candidate.parent_sku}`,
    description: `Local-only quantity-one draft from technical batch ${scope.batch_id}.`,
    parent: {
      product_gid: live.parent.live.product_gid,
      variant_gid: live.parent.live.variant_gid,
      variant_selection_strategy: "fixed",
      sku: candidate.parent_sku,
      title: candidate.parent.product_title || candidate.parent.variant_title || candidate.parent_sku,
      template_handle: "product",
    },
    selection: { cart_quantity: 1, cart_parent_line_mode: "single_parent_line", checkout_line_mode: "expanded_components" },
    component_groups: groups,
    compatibility_rules: [],
    presets: [{
      preset_id: "fixed_bundle",
      label: "Fixed bundle",
      description: "",
      active: true,
      display_order: 10,
      locked_selections: lockedSelections,
      validate_compatibility: true,
      image_ref: {},
      selections,
    }],
    pricing: {
      component_price_source: "published_parent_price_proportional_allocation",
      base_price_cents: 0,
      discount: { type: "none", basis_points: 0, allocation: "per_component_with_delta_to_last_line" },
      rounding: "preallocated_exact_bundle_total",
      currency: "shop_currency",
      price_evidence: { ...priceEvidenceBody, checksum: calculateStableValueChecksum(priceEvidenceBody) },
    },
    images: { fallback: { strategy: "product_featured_media" } },
    metadata: { bundle_contract_version: "1", emit_component_group: true, emit_component_role: true, emit_component_sequence: true, future_fields: [] },
    audit: { created_by: scope.draft_created_by, created_at: scope.draft_created_at, published_by: null, published_at: null },
    revision: { draft_revision: 1, published_revision: 1 },
  };
  assertValidBundleConfig(configuration);
  const definition = parseBundleDefinition({
    schema_version: "bundle_definition.v1",
    bundle_definition_id: definitionId,
    slug,
    parent_binding: { product_gid: configuration.parent.product_gid, variant_gid: configuration.parent.variant_gid },
    active_revision_id: null,
    created_at: scope.draft_created_at,
    updated_at: scope.draft_created_at,
  });
  const revision = parseBundleRevision({
    schema_version: "bundle_revision.v1",
    revision_id: revisionId,
    bundle_definition_id: definitionId,
    revision_number: 1,
    status: "draft",
    configuration,
    runtime_snapshot_ref: null,
    created_at: scope.draft_created_at,
    updated_at: scope.draft_created_at,
    created_by: scope.draft_created_by,
  });
  const snapshot = compileRuntimeSnapshot(configuration);
  return { definition, revision, compile_preview: { checksum: snapshot.checksum, byte_size: Buffer.byteLength(JSON.stringify(snapshot), "utf8"), component_count: groups.length } };
}

function assertBatchInputs(readiness, live, scope) {
  if (readiness?.batch_id !== scope?.batch_id || live?.batch_id !== scope?.batch_id) throw new Error("technical batch evidence does not match scope");
  if (!Array.isArray(scope?.parent_skus) || !scope.draft_created_at || !scope.draft_created_by) throw new Error("technical batch draft metadata is incomplete");
}

function liveReadbackStore() {
  return "huang-mvqquz1p.myshopify.com";
}

function stableUuid(seed) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
