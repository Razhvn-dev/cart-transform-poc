import { RUNTIME_SNAPSHOT_HASH_ALGORITHM } from "./bundle-config.schema.js";

export function stableSerialize(value) {
  return JSON.stringify(sortForStableSerialization(value));
}

export function calculateRuntimeSnapshotChecksum(snapshot) {
  const serialized = stableSerialize({
    ...snapshot,
    checksum: undefined,
    checksum_algorithm: undefined,
  });

  return fnv1a32(serialized);
}

export function calculateStableValueChecksum(value) {
  return fnv1a32(stableSerialize(value));
}

export function calculateSerializedValueChecksum(value) {
  return fnv1a32(value);
}

export function attachRuntimeSnapshotChecksum(snapshot) {
  const snapshotWithoutChecksum = {
    ...snapshot,
    checksum_algorithm: RUNTIME_SNAPSHOT_HASH_ALGORITHM,
  };

  return Object.freeze({
    ...snapshotWithoutChecksum,
    checksum: calculateRuntimeSnapshotChecksum(snapshotWithoutChecksum),
  });
}

function sortForStableSerialization(value) {
  if (Array.isArray(value)) return value.map(sortForStableSerialization);
  if (!isPlainObject(value)) return value;

  return Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .reduce((acc, key) => {
      acc[key] = sortForStableSerialization(value[key]);
      return acc;
    }, {});
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
