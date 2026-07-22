import { findUnsupportedFunctionResultShape } from "./bundle-runtime.result-comparator.js";
import { parseJsonObjectMetafield } from "./bundle-runtime.extraction.js";
import { observePrebuiltBundleCartMetadata } from "./prebuilt-bundle-cart-metadata.observation.js";
import { validatePrebuiltBundleExpandProjection } from "./prebuilt-bundle-expand-projection.js";

/**
 * Hosted-runtime path for fixed pre-built bundles. Publication resolves the
 * complete selection; Checkout validates one compact projection and emits it.
 */
export function buildPrebuiltBundleProjectionFunctionCandidate(input) {
  const prepared = [];
  const seenBundleIds = new Set();
  let validMetadataCount = 0;
  let invalid = false;

  for (const line of input?.cart?.lines ?? []) {
    const metafield = line?.merchandise?.product?.prebuiltExpandProjectionMetafield;
    if (!metafield) continue;

    const metadata = observePrebuiltBundleCartMetadata(line);
    const projection = parseJsonObjectMetafield(metafield);
    if (metadata.status !== "valid" || !projectionMatchesLine(projection, line)) {
      invalid = true;
      continue;
    }

    validMetadataCount += 1;
    if (seenBundleIds.has(metadata.metadata.bundle_instance_id)) {
      invalid = true;
      continue;
    }
    seenBundleIds.add(metadata.metadata.bundle_instance_id);
    prepared.push({ line, metadata: metadata.metadata, projection });
  }

  const result = invalid ? { operations: [] } : {
    operations: prepared.map(({ line, metadata, projection }) => ({
      expand: {
        cartLineId: line.id,
        title: projection.parent.title,
        expandedCartItems: projection.components.map((component) => ({
          merchandiseId: component.variant_gid,
          quantity: 1,
          attributes: buildMetadataV1Attributes(metadata, projection, component),
          price: {
            adjustment: {
              fixedPricePerUnit: { amount: component.fixed_price_per_unit },
            },
          },
        })),
      },
    })),
  };
  const operationShapeIssues = findUnsupportedFunctionResultShape(result, "projection");
  const ready = !invalid
    && validMetadataCount > 0
    && prepared.length === validMetadataCount
    && operationShapeIssues.length === 0;

  return deepFreeze({
    status: ready ? "ready" : "unavailable",
    valid_metadata_count: validMetadataCount,
    prepared_candidate_count: prepared.length,
    operation_shape_issues: operationShapeIssues,
    result: ready ? result : { operations: [] },
  });
}

function projectionMatchesLine(projection, line) {
  return projection != null
    && validatePrebuiltBundleExpandProjection(projection).length === 0
    && projection.parent.variant_gid === line?.merchandise?.id
    && projection.parent.product_gid === line?.merchandise?.product?.id
    && projectionPriceMatchesLine(projection, line);
}

function projectionPriceMatchesLine(projection, line) {
  const parentPriceCents = decimalToCents(line?.cost?.amountPerQuantity?.amount);
  const componentPriceCents = projection.components.reduce((total, component) => {
    const cents = decimalToCents(component.fixed_price_per_unit);
    return total == null || cents == null ? null : total + cents;
  }, 0);
  return parentPriceCents != null && componentPriceCents === parentPriceCents;
}

function decimalToCents(value) {
  if (!/^\d+\.\d{2}$/.test(value ?? "")) return null;
  const [whole, fraction] = value.split(".");
  const cents = (Number(whole) * 100) + Number(fraction);
  return Number.isSafeInteger(cents) ? cents : null;
}

function buildMetadataV1Attributes(metadata, projection, component) {
  return [
    attribute("_bundle_id", metadata.bundle_instance_id),
    attribute("_bundle_schema_version", metadata.schema_version),
    attribute("_parent_product_gid", projection.parent.product_gid),
    attribute("_parent_variant_gid", projection.parent.variant_gid),
    attribute("_parent_sku", projection.parent.sku),
    attribute("_parent_title", projection.parent.title),
    attribute("_component_group", component.group),
    attribute("_component_role", component.role),
    attribute("_component_variant_gid", component.variant_gid),
    attribute("_component_sequence", String(component.sequence)),
  ];
}

function attribute(key, value) {
  return { key, value };
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
