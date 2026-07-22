import { createNextDraftRevision, updateDraftRevision } from "./bundle-domain.lifecycle.js";
import { calculateStableValueChecksum } from "./bundle-runtime.checksum.js";

export const PREBUILT_PRICE_EVIDENCE_SCHEMA_VERSION = "prebuilt_bundle_price_evidence.v1";

export function buildPriceEvidencedDraftRevision({
  publishedRevision,
  revisionId,
  createdAt,
  createdBy,
  storeDomain,
  parent,
  components,
}) {
  assertMoneyEvidence({ storeDomain, parent, components });
  if (publishedRevision.configuration.parent.variant_gid !== parent.variant_gid) {
    throw new Error("price evidence parent Variant does not match the published revision");
  }

  const next = createNextDraftRevision({
    publishedRevision,
    revisionId,
    createdAt,
    createdBy,
  });
  const configuration = structuredClone(next.configuration);
  const configuredOptions = configuration.component_groups.flatMap((group) => group.options);
  const evidenceByVariant = new Map(components.map((component) => [component.variant_gid, component]));
  if (evidenceByVariant.size !== components.length || configuredOptions.length !== components.length) {
    throw new Error("price evidence must map every configured component Variant exactly once");
  }
  for (const option of configuredOptions) {
    if (!evidenceByVariant.has(option.variant_gid)) {
      throw new Error(`price evidence is missing configured component ${option.variant_gid}`);
    }
  }

  const sourceTotalCents = components.reduce((total, component) => total + component.variant_price_cents, 0);
  if (sourceTotalCents <= 0 || parent.variant_price_cents > sourceTotalCents) {
    throw new Error("parent price must be no greater than the positive component subtotal");
  }
  const allocated = allocateProportionally(components, parent.variant_price_cents, sourceTotalCents);
  const allocatedByVariant = new Map(components.map((component, index) => [
    component.variant_gid,
    allocated[index],
  ]));
  for (const group of configuration.component_groups) {
    for (const option of group.options) {
      option.price_cents_snapshot = allocatedByVariant.get(option.variant_gid);
      option.price_source = "shopify_parent_price_proportional_allocation";
    }
  }

  const evidenceBody = {
    schema_version: PREBUILT_PRICE_EVIDENCE_SCHEMA_VERSION,
    store_domain: storeDomain,
    captured_at: createdAt,
    parent: {
      variant_gid: parent.variant_gid,
      sku: parent.sku,
      variant_price_cents: parent.variant_price_cents,
    },
    component_subtotal_cents: sourceTotalCents,
    bundle_price_cents: parent.variant_price_cents,
    discount_cents: sourceTotalCents - parent.variant_price_cents,
    allocation_method: "proportional_to_variant_price_with_delta_to_last",
    components: components.map((component, index) => ({
      variant_gid: component.variant_gid,
      sku: component.sku,
      variant_price_cents: component.variant_price_cents,
      allocated_price_cents: allocated[index],
    })),
    allocation_total_cents: allocated.reduce((total, cents) => total + cents, 0),
  };
  configuration.pricing = {
    ...configuration.pricing,
    component_price_source: "published_parent_price_proportional_allocation",
    price_evidence: {
      ...evidenceBody,
      checksum: calculateStableValueChecksum(evidenceBody),
    },
  };
  configuration.audit = {
    ...configuration.audit,
    created_by: createdBy,
    created_at: createdAt,
    published_by: null,
    published_at: null,
  };

  return updateDraftRevision(next, { configuration, updated_at: createdAt });
}

export function allocateProportionally(components, targetTotalCents, sourceTotalCents) {
  const allocated = components.map((component) => {
    const numerator = component.variant_price_cents * targetTotalCents;
    if (!Number.isSafeInteger(numerator)) throw new Error("price allocation exceeds safe integer precision");
    return Math.round(numerator / sourceTotalCents);
  });
  allocated[allocated.length - 1] += targetTotalCents
    - allocated.reduce((total, cents) => total + cents, 0);
  if (allocated.some((cents) => cents < 0)) throw new Error("price allocation produced a negative component price");
  return allocated;
}

function assertMoneyEvidence({ storeDomain, parent, components }) {
  if (typeof storeDomain !== "string" || storeDomain.trim() === "") throw new Error("storeDomain is required");
  if (!isPriceItem(parent)) throw new Error("parent price evidence is invalid");
  if (!Array.isArray(components) || components.length === 0 || components.some((component) => !isPriceItem(component))) {
    throw new Error("component price evidence is invalid");
  }
}

function isPriceItem(item) {
  return typeof item?.variant_gid === "string"
    && typeof item?.sku === "string"
    && item.sku.trim() !== ""
    && Number.isSafeInteger(item?.variant_price_cents)
    && item.variant_price_cents >= 0;
}
