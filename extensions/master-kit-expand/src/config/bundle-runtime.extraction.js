export function observeRuntimeSnapshotInput(input) {
  for (const line of input.cart?.lines || []) {
    const snapshot = parseRuntimeSnapshotMetafield(
      line.merchandise?.product?.runtimeSnapshotDevMetafield,
    );

    if (snapshot) return snapshot;
  }

  return null;
}

export function parseRuntimeSnapshotMetafield(metafield) {
  return parseJsonObjectMetafield(metafield);
}

export function parseJsonObjectMetafield(metafield) {
  if (!metafield) return null;

  if (isPlainObject(metafield.jsonValue)) {
    return metafield.jsonValue;
  }

  if (typeof metafield.value !== "string" || metafield.value.trim() === "") {
    return null;
  }

  try {
    const parsed = JSON.parse(metafield.value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
