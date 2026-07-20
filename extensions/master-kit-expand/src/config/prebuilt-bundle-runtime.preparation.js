import { resolvePrebuiltBundleSelection } from "./prebuilt-bundle-runtime.selection.js";

/**
 * Prepares only server-authorized pre-built Bundle candidates. This is not a
 * Function operation builder and deliberately does not inspect cart attributes.
 */
export function preparePrebuiltBundleRuntimeSelections(cartLines, dependencies = {}) {
  const resolve = dependencies.resolve ?? resolvePrebuiltBundleSelection;
  const lookupMapping = dependencies.lookupMapping ?? (() => null);
  const lookupSnapshot = dependencies.lookupSnapshot ?? (() => null);
  const lookupBundleMetadata = dependencies.lookupBundleMetadata ?? (() => null);

  if (!Array.isArray(cartLines)) return [];

  return cartLines.reduce((prepared, cartLine) => {
    const parentVariantGid = cartLine?.merchandise?.__typename === "ProductVariant"
      ? cartLine.merchandise.id
      : null;
    if (!parentVariantGid) return prepared;

    try {
      const mapping = lookupMapping(parentVariantGid);
      const snapshot = mapping ? lookupSnapshot(mapping) : null;
      const resolution = resolve({ parent_variant_gid: parentVariantGid, mapping, snapshot });
      if (resolution.status !== "resolved") return prepared;

      const bundleMetadata = lookupBundleMetadata(cartLine);
      prepared.push(deepFreeze({
        cart_line_id: cartLine.id,
        parent_variant_gid: parentVariantGid,
        mapping: resolution.mapping,
        resolved_candidate: resolution.resolved,
        ...(bundleMetadata ? { bundle_metadata: bundleMetadata } : {}),
      }));
      return prepared;
    } catch {
      return prepared;
    }
  }, []);
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
