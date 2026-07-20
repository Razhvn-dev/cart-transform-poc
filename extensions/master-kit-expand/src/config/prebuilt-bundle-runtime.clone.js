/**
 * Clones the JSON-shaped values that cross the pre-built Function boundary.
 * Javy does not provide structuredClone, so this intentionally supports only
 * the primitives, arrays, and plain objects returned by Cart Transform input.
 */
export function clonePrebuiltBundleRuntimeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => clonePrebuiltBundleRuntimeValue(item));
  }

  if (value != null && typeof value === "object") {
    const clone = {};
    Object.keys(value).forEach((key) => {
      clone[key] = clonePrebuiltBundleRuntimeValue(value[key]);
    });
    return clone;
  }

  return value;
}
