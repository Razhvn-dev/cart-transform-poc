import { observeRuntimeSnapshotInput } from "./bundle-runtime.extraction.js";
import { validateRuntimeSnapshot } from "./bundle-runtime.validator.js";

export function observeRuntimeSnapshotValidation(input) {
  try {
    const snapshot = observeRuntimeSnapshotInput(input);
    return snapshot ? validateRuntimeSnapshot(snapshot) : null;
  } catch {
    return null;
  }
}
