import {
  BUNDLE_CONFIG_SCHEMA_VERSION,
  BUNDLE_RUNTIME_SCHEMA_VERSION,
  RUNTIME_SNAPSHOT_HASH_ALGORITHM,
  UUID_REGEX,
} from "./bundle-config.schema.js";

export const BUNDLE_DEFINITION_SCHEMA_VERSION = "bundle_definition.v1";
export const BUNDLE_REVISION_SCHEMA_VERSION = "bundle_revision.v1";
export const BUNDLE_PUBLICATION_ATTEMPT_SCHEMA_VERSION =
  "bundle_publication_attempt.v1";

export const BUNDLE_REVISION_STATUSES = new Set([
  "draft",
  "published",
  "superseded",
  "archived",
]);

export const PUBLICATION_ATTEMPT_STATES = new Set([
  "pending",
  "compiled",
  "snapshot_written",
  "snapshot_verified",
  "active_pointer_updated",
  "recorded",
  "failed",
  "compensating",
  "compensated",
]);

export const PUBLICATION_ATTEMPT_TRANSITIONS = new Map([
  ["pending", new Set(["compiled", "failed"])],
  ["compiled", new Set(["snapshot_written", "failed"])],
  ["snapshot_written", new Set(["snapshot_verified", "failed", "compensating"])],
  ["snapshot_verified", new Set(["active_pointer_updated", "failed", "compensating"])],
  ["active_pointer_updated", new Set(["recorded", "failed", "compensating"])],
  ["failed", new Set(["compensating"])],
  ["compensating", new Set(["compensated", "failed"])],
  ["recorded", new Set()],
  ["compensated", new Set()],
]);

export const REVISION_TRANSITIONS = new Map([
  ["draft", new Set(["published", "archived"])],
  ["published", new Set(["superseded", "archived"])],
  ["superseded", new Set(["published", "archived"])],
  ["archived", new Set()],
]);

export const BUNDLE_DOMAIN_CONSTANTS = {
  bundleConfigSchemaVersion: BUNDLE_CONFIG_SCHEMA_VERSION,
  runtimeSnapshotSchemaVersion: BUNDLE_RUNTIME_SCHEMA_VERSION,
  runtimeSnapshotHashAlgorithm: RUNTIME_SNAPSHOT_HASH_ALGORITHM,
  uuidRegex: UUID_REGEX,
};
