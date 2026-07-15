const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_GID_REGEX = /^gid:\/\/shopify\/Product\/\d+$/;

export function buildResolvedRuntimeSnapshotFunctionResult(preparedSnapshots) {
  const operations = (preparedSnapshots || [])
    .map(buildExpandOperation)
    .filter(Boolean)
    .map((expand) => ({ expand }));

  return { operations };
}

function buildExpandOperation({ cartLine, resolvedCandidate }) {
  const merchandise = cartLine.merchandise;

  if (merchandise?.__typename !== "ProductVariant") return null;
  if (merchandise.id !== resolvedCandidate.parent.variant_gid) return null;

  const bundleMetadata = getBundleMetadata(cartLine, merchandise);

  return {
    cartLineId: cartLine.id,
    title: resolvedCandidate.parent.title,
    expandedCartItems: resolvedCandidate.components.map((component, index) => ({
      merchandiseId: component.variantId,
      quantity: 1,
      ...(bundleMetadata
        ? { attributes: buildExpandedItemAttributes(bundleMetadata, component, index) }
        : {}),
      price: {
        adjustment: {
          fixedPricePerUnit: {
            amount: component.fixedPricePerUnit,
          },
        },
      },
    })),
  };
}

function getBundleMetadata(cartLine, merchandise) {
  const bundleId = cartLine.bundleId?.value?.trim();
  const schemaVersion = cartLine.bundleSchemaVersion?.value?.trim();
  const parentProductGid = merchandise.product?.id;

  if (
    !UUID_REGEX.test(bundleId || "") ||
    schemaVersion !== "1" ||
    !PRODUCT_GID_REGEX.test(parentProductGid || "")
  ) {
    return null;
  }

  return {
    bundleId,
    schemaVersion,
    parentProductGid,
    parentVariantGid: merchandise.id,
    parentSku: cartLine.parentSku?.value ?? "",
    parentTitle: cartLine.parentTitle?.value ?? "",
  };
}

function buildExpandedItemAttributes(bundleMetadata, component, index) {
  return [
    attribute("_bundle_id", bundleMetadata.bundleId),
    attribute("_bundle_schema_version", bundleMetadata.schemaVersion),
    attribute("_parent_product_gid", bundleMetadata.parentProductGid),
    attribute("_parent_variant_gid", bundleMetadata.parentVariantGid),
    attribute("_parent_sku", bundleMetadata.parentSku),
    attribute("_parent_title", bundleMetadata.parentTitle),
    attribute("_component_group", component.componentGroup),
    attribute("_component_role", component.componentRole),
    attribute("_component_variant_gid", component.variantId),
    attribute("_component_sequence", String(index + 1)),
  ];
}

function attribute(key, value) {
  return { key, value };
}
