import { assertValidRuntimeSnapshot } from "./bundle-runtime.validator.js";
import { resolveValidatedRuntimeBundleSelection } from "./bundle-runtime.resolver-core.js";

export { resolveValidatedRuntimeBundleSelection } from "./bundle-runtime.resolver-core.js";

export function resolveRuntimeBundleSelection(snapshot, selectionsByCartAttribute = {}) {
  assertValidRuntimeSnapshot(snapshot);
  return resolveValidatedRuntimeBundleSelection(snapshot, selectionsByCartAttribute);
}
