import { parseRuntimeSnapshotMetafield } from "./bundle-runtime.extraction.js";
import { resolveValidatedRuntimeBundleSelection } from "./bundle-runtime.resolver.js";
import { validateRuntimeSnapshot } from "./bundle-runtime.validator.js";

export function observeRuntimeSnapshotResolution(input, dependencies = {}) {
  const parse = dependencies.parse ?? parseRuntimeSnapshotMetafield;
  const validate = dependencies.validate ?? validateRuntimeSnapshot;
  const resolve = dependencies.resolve ?? resolveValidatedRuntimeBundleSelection;

  try {
    const preparedSnapshots = [];

    for (const line of input.cart?.lines || []) {
      const snapshot = parse(
        line.merchandise?.product?.runtimeSnapshotDevMetafield,
      );
      if (!snapshot || validate(snapshot).length > 0) continue;

      preparedSnapshots.push({
        cartLine: line,
        snapshot,
        resolvedCandidate: resolve(snapshot, selectionsByCartAttribute(line, snapshot)),
      });
    }

    return preparedSnapshots;
  } catch {
    return null;
  }
}

function selectionsByCartAttribute(line, snapshot) {
  return snapshot.groups.reduce((selections, group) => {
    selections[group.cart_attribute] = line[cartLineFieldForAttribute(group.cart_attribute)]?.value;
    return selections;
  }, {});
}

function cartLineFieldForAttribute(attribute) {
  return attribute
    .replace(/^_builder_/, "builder_")
    .replace(/^_/, "")
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
