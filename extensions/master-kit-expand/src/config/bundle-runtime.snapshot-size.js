export const RUNTIME_SNAPSHOT_TARGET_BYTES = 7_000;
export const RUNTIME_SNAPSHOT_WARNING_BYTES = 7_500;
export const RUNTIME_SNAPSHOT_HARD_LIMIT_BYTES = 9_000;

export function assertRuntimeSnapshotMetafieldSize(metafield) {
  if (!metafield) return { ok: true };

  const serialized = isPlainObject(metafield.jsonValue)
    ? JSON.stringify(metafield.jsonValue)
    : typeof metafield.value === "string"
      ? metafield.value
      : "";
  const sizeBytes = utf8ByteLength(serialized);

  if (sizeBytes > RUNTIME_SNAPSHOT_HARD_LIMIT_BYTES) {
    return {
      ok: false,
      reason: "snapshot_size_hard_limit",
      sizeBytes,
      targetBytes: RUNTIME_SNAPSHOT_TARGET_BYTES,
      warningBytes: RUNTIME_SNAPSHOT_WARNING_BYTES,
      hardLimitBytes: RUNTIME_SNAPSHOT_HARD_LIMIT_BYTES,
    };
  }

  return {
    ok: true,
    sizeBytes,
    warning: sizeBytes > RUNTIME_SNAPSHOT_WARNING_BYTES
      ? "snapshot_size_warning"
      : null,
    targetBytes: RUNTIME_SNAPSHOT_TARGET_BYTES,
    warningBytes: RUNTIME_SNAPSHOT_WARNING_BYTES,
    hardLimitBytes: RUNTIME_SNAPSHOT_HARD_LIMIT_BYTES,
  };
}

function utf8ByteLength(value) {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint > 0xffff) index += 1;

    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }

  return bytes;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
