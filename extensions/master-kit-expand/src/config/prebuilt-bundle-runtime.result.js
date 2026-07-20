/**
 * Converts prepared, server-authorized pre-built candidates into the supported
 * Cart Transform expand shape used by the dev-only candidate entry.
 */
export function buildPrebuiltBundleFunctionResult(preparedCandidates) {
  const operations = (preparedCandidates || [])
    .map(buildExpandOperation)
    .filter(Boolean)
    .map((expand) => ({ expand }));

  return { operations };
}

function buildExpandOperation(candidate) {
  const resolved = candidate?.resolved_candidate;
  if (!isNonEmptyString(candidate?.cart_line_id) || !isPlainObject(resolved?.parent) || !Array.isArray(resolved.components)) {
    return null;
  }
  if (!isNonEmptyString(resolved.parent.title) || resolved.components.length === 0) return null;

  const expandedCartItems = resolved.components.map((component) => {
    if (!isNonEmptyString(component?.variantId) || !isNonEmptyString(component?.fixedPricePerUnit)) return null;
    return {
      merchandiseId: component.variantId,
      quantity: 1,
      ...(buildExpandedItemAttributes(candidate, component) ?? {}),
      price: {
        adjustment: {
          fixedPricePerUnit: {
            amount: component.fixedPricePerUnit,
          },
        },
      },
    };
  });

  if (expandedCartItems.some((item) => item === null)) return null;
  return {
    cartLineId: candidate.cart_line_id,
    title: resolved.parent.title,
    expandedCartItems,
  };
}

function buildExpandedItemAttributes(candidate, component) {
  const metadata = candidate?.bundle_metadata;
  const parent = candidate?.resolved_candidate?.parent;
  if (
    !isNonEmptyString(metadata?.bundle_instance_id)
    || metadata.schema_version !== "1"
    || !isNonEmptyString(parent?.product_gid)
    || !isNonEmptyString(parent?.variant_gid)
    || !isNonEmptyString(component?.componentGroup)
    || !isNonEmptyString(component?.componentRole)
  ) {
    return null;
  }

  return {
    attributes: [
      attribute("_bundle_id", metadata.bundle_instance_id),
      attribute("_bundle_schema_version", metadata.schema_version),
      attribute("_parent_product_gid", parent.product_gid),
      attribute("_parent_variant_gid", parent.variant_gid),
      attribute("_parent_sku", parent.sku ?? ""),
      attribute("_parent_title", parent.title ?? ""),
      attribute("_component_group", component.componentGroup),
      attribute("_component_role", component.componentRole),
      attribute("_component_variant_gid", component.variantId),
      attribute("_component_sequence", String(component.sequence)),
    ],
  };
}

function attribute(key, value) {
  return { key, value };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
