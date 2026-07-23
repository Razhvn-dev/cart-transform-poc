import { parseJsonObjectMetafield } from "./bundle-runtime.extraction.js";
import { observePrebuiltBundleCartMetadata } from "./prebuilt-bundle-cart-metadata.observation.js";
import { isValidPrebuiltBundleExpandProjection } from "./prebuilt-bundle-expand-projection.js";

/**
 * Hosted-runtime path for fixed pre-built bundles. Publication resolves the
 * complete selection; Checkout validates one compact projection and emits it.
 */
export function buildPrebuiltBundleProjectionFunctionCandidate(input) {
  const lines = input?.cart?.lines ?? [];
  const prepared = [];
  const seenBundleIds = lines.length > 1 ? new Set() : null;
  let validMetadataCount = 0;
  let invalid = false;

  for (const line of lines) {
    const metafield = line?.merchandise?.product?.prebuiltExpandProjectionMetafield;
    if (!metafield) continue;

    const metadata = observePrebuiltBundleCartMetadata(line, false);
    const projection = parseJsonObjectMetafield(metafield);
    if (metadata == null || !projectionMatchesLine(projection, line)) {
      invalid = true;
      continue;
    }

    validMetadataCount += 1;
    if (seenBundleIds?.has(metadata.bundle_instance_id)) {
      invalid = true;
      continue;
    }
    seenBundleIds?.add(metadata.bundle_instance_id);
    prepared.push({ line, metadata, projection });
  }

  const result = invalid ? { operations: [] } : {
    operations: prepared.map(buildExpandOperation),
  };
  const operationShapeIssues = [];
  const ready = !invalid
    && validMetadataCount > 0
    && prepared.length === validMetadataCount
    && operationShapeIssues.length === 0;

  return {
    status: ready ? "ready" : "unavailable",
    valid_metadata_count: validMetadataCount,
    prepared_candidate_count: prepared.length,
    operation_shape_issues: operationShapeIssues,
    result: ready ? result : { operations: [] },
  };
}

export function buildSinglePrebuiltBundleProjectionFunctionResult(input) {
  const lines = input?.cart?.lines;
  if (lines == null || lines.length !== 1) return null;
  const line = lines[0];
  const metafield = line?.merchandise?.product?.prebuiltExpandProjectionMetafield;
  if (!metafield) return null;

  const metadata = observePrebuiltBundleCartMetadata(line, false);
  const projection = metafield.jsonValue;
  if (metadata == null || !projectionMatchesLine(projection, line)) {
    return { operations: [] };
  }
  return { operations: [buildExpandOperation({ line, metadata, projection })] };
}

function projectionMatchesLine(projection, line) {
  return projection != null
    && isValidPrebuiltBundleExpandProjection(projection)
    && projection.parent.variant_gid === line?.merchandise?.id
    && projection.parent.product_gid === line?.merchandise?.product?.id
    && projectionPriceMatchesLine(projection, line);
}

function projectionPriceMatchesLine(projection, line) {
  const parentPriceCents = decimalToCents(line?.cost?.amountPerQuantity?.amount);
  const componentPriceCents = projection.components.reduce((total, component) => {
    // Projection validation already guarantees the fixed two-decimal shape.
    const cents = Math.round(Number(component.fixed_price_per_unit) * 100);
    return total == null || !Number.isSafeInteger(cents) ? null : total + cents;
  }, 0);
  return parentPriceCents != null && componentPriceCents === parentPriceCents;
}

function decimalToCents(value) {
  if (!/^\d+\.\d{2}$/.test(value ?? "")) return null;
  const [whole, fraction] = value.split(".");
  const cents = (Number(whole) * 100) + Number(fraction);
  return Number.isSafeInteger(cents) ? cents : null;
}

function buildExpandOperation({ line, metadata, projection }) {
  const parentAttributes = [
    { key: "_bundle_id", value: metadata.bundle_instance_id },
    { key: "_bundle_schema_version", value: metadata.schema_version },
    { key: "_parent_product_gid", value: projection.parent.product_gid },
    { key: "_parent_variant_gid", value: projection.parent.variant_gid },
    { key: "_parent_sku", value: projection.parent.sku },
    { key: "_parent_title", value: projection.parent.title },
  ];
  return {
    expand: {
      cartLineId: line.id,
      title: projection.parent.title,
      expandedCartItems: projection.components.map((component) => ({
        merchandiseId: component.variant_gid,
        quantity: 1,
        attributes: [
          parentAttributes[0],
          parentAttributes[1],
          parentAttributes[2],
          parentAttributes[3],
          parentAttributes[4],
          parentAttributes[5],
          { key: "_component_group", value: component.group },
          { key: "_component_role", value: component.role },
          { key: "_component_variant_gid", value: component.variant_gid },
          { key: "_component_sequence", value: String(component.sequence) },
        ],
        price: {
          adjustment: {
            fixedPricePerUnit: { amount: component.fixed_price_per_unit },
          },
        },
      })),
    },
  };
}
