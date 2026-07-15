import {
  BUNDLE_CONFIG_SCHEMA_VERSION,
  BUNDLE_RUNTIME_SCHEMA_VERSION,
  PRODUCT_GID_REGEX,
  PRODUCT_VARIANT_GID_REGEX,
  RUNTIME_SNAPSHOT_HASH_ALGORITHM,
  UUID_REGEX,
} from "./bundle-config.schema.js";
import { validateBundleConfig } from "./bundle-config.validator.js";
import {
  BUNDLE_DEFINITION_SCHEMA_VERSION,
  BUNDLE_PUBLICATION_ATTEMPT_SCHEMA_VERSION,
  BUNDLE_REVISION_SCHEMA_VERSION,
  BUNDLE_REVISION_STATUSES,
  PUBLICATION_ATTEMPT_STATES,
} from "./bundle-domain.schema.js";

export class BundleDomainValidationError extends Error {
  constructor(errors) {
    super(`Bundle domain record is invalid: ${errors.join("; ")}`);
    this.name = "BundleDomainValidationError";
    this.errors = errors;
  }
}

export function validateBundleDefinition(definition) {
  const errors = [];
  if (!isPlainObject(definition)) return ["definition must be an object"];

  rejectBundleInstanceFields(errors, definition, "definition");
  requireEqual(errors, "definition.schema_version", definition.schema_version, BUNDLE_DEFINITION_SCHEMA_VERSION);
  requirePattern(errors, "definition.bundle_definition_id", definition.bundle_definition_id, UUID_REGEX);
  requireNonEmptyString(errors, "definition.slug", definition.slug);
  validateParentBinding(errors, definition.parent_binding, "definition.parent_binding");
  if (definition.active_revision_id !== null) {
    requirePattern(errors, "definition.active_revision_id", definition.active_revision_id, UUID_REGEX);
  }
  requireIsoDate(errors, "definition.created_at", definition.created_at);
  requireIsoDate(errors, "definition.updated_at", definition.updated_at);
  return errors;
}

export function validateBundleRevision(revision) {
  const errors = [];
  if (!isPlainObject(revision)) return ["revision must be an object"];

  rejectBundleInstanceFields(errors, revision, "revision");
  requireEqual(errors, "revision.schema_version", revision.schema_version, BUNDLE_REVISION_SCHEMA_VERSION);
  requirePattern(errors, "revision.revision_id", revision.revision_id, UUID_REGEX);
  requirePattern(errors, "revision.bundle_definition_id", revision.bundle_definition_id, UUID_REGEX);
  requireInteger(errors, "revision.revision_number", revision.revision_number, { min: 1 });
  requireEnum(errors, "revision.status", revision.status, BUNDLE_REVISION_STATUSES);
  requireIsoDate(errors, "revision.created_at", revision.created_at);
  requireIsoDate(errors, "revision.updated_at", revision.updated_at);
  requireNonEmptyString(errors, "revision.created_by", revision.created_by);

  if (!isPlainObject(revision.configuration)) {
    errors.push("revision.configuration must be an object");
  } else {
    const configErrors = validateBundleConfig(revision.configuration);
    errors.push(...configErrors.map((error) => `revision.configuration.${error}`));
    requireEqual(
      errors,
      "revision.configuration.schema_version",
      revision.configuration.schema_version,
      BUNDLE_CONFIG_SCHEMA_VERSION,
    );
    if (revision.configuration.configuration_id !== revision.bundle_definition_id) {
      errors.push("revision.configuration.configuration_id must equal revision.bundle_definition_id");
    }
    if (revision.configuration.configuration_version !== revision.revision_number) {
      errors.push("revision.configuration.configuration_version must equal revision.revision_number");
    }
  }

  if (revision.runtime_snapshot_ref !== null) {
    validateRuntimeSnapshotRef(errors, revision.runtime_snapshot_ref, "revision.runtime_snapshot_ref");
    if (revision.runtime_snapshot_ref?.configuration_version !== revision.revision_number) {
      errors.push("revision.runtime_snapshot_ref.configuration_version must equal revision.revision_number");
    }
  }

  if (revision.status === "published" && revision.runtime_snapshot_ref === null) {
    errors.push("published revision requires runtime_snapshot_ref");
  }
  return errors;
}

export function validatePublicationAttempt(attempt) {
  const errors = [];
  if (!isPlainObject(attempt)) return ["publication attempt must be an object"];

  rejectBundleInstanceFields(errors, attempt, "publication attempt");
  requireEqual(
    errors,
    "publication_attempt.schema_version",
    attempt.schema_version,
    BUNDLE_PUBLICATION_ATTEMPT_SCHEMA_VERSION,
  );
  requirePattern(errors, "publication_attempt.publication_id", attempt.publication_id, UUID_REGEX);
  requirePattern(errors, "publication_attempt.bundle_definition_id", attempt.bundle_definition_id, UUID_REGEX);
  requirePattern(errors, "publication_attempt.revision_id", attempt.revision_id, UUID_REGEX);
  requireInteger(errors, "publication_attempt.revision_number", attempt.revision_number, { min: 1 });
  requireNonEmptyString(errors, "publication_attempt.retry_identity", attempt.retry_identity);
  requireInteger(errors, "publication_attempt.attempt_number", attempt.attempt_number, { min: 1 });
  requireEnum(errors, "publication_attempt.state", attempt.state, PUBLICATION_ATTEMPT_STATES);
  validateRuntimeSnapshotRef(errors, attempt.runtime_snapshot_ref, "publication_attempt.runtime_snapshot_ref");
  if (isPlainObject(attempt.runtime_snapshot_ref)) {
    const expectedRetryIdentity = [
      attempt.bundle_definition_id,
      attempt.revision_id,
      attempt.runtime_snapshot_ref.checksum,
    ].join(":");
    if (attempt.retry_identity !== expectedRetryIdentity) {
      errors.push("publication_attempt.retry_identity must match definition, revision, and checksum");
    }
  }
  if (attempt.previous_active_revision_id !== null) {
    requirePattern(
      errors,
      "publication_attempt.previous_active_revision_id",
      attempt.previous_active_revision_id,
      UUID_REGEX,
    );
  }
  requireIsoDate(errors, "publication_attempt.created_at", attempt.created_at);
  requireIsoDate(errors, "publication_attempt.updated_at", attempt.updated_at);
  return errors;
}

export function validateBundleDefinitionCollection(definitions) {
  const errors = [];
  if (!Array.isArray(definitions)) return ["definitions must be an array"];

  const ids = new Set();
  const parentVariants = new Set();
  definitions.forEach((definition, index) => {
    errors.push(...validateBundleDefinition(definition).map((error) => `definitions[${index}].${error}`));
    if (!isPlainObject(definition)) return;
    if (ids.has(definition.bundle_definition_id)) {
      errors.push(`duplicate bundle_definition_id "${definition.bundle_definition_id}"`);
    }
    ids.add(definition.bundle_definition_id);
    const variantGid = definition.parent_binding?.variant_gid;
    if (typeof variantGid === "string") {
      if (parentVariants.has(variantGid)) {
        errors.push(`duplicate parent variant binding "${variantGid}"`);
      }
      parentVariants.add(variantGid);
    }
  });
  return errors;
}

export function validateBundleRevisionCollection(revisions) {
  const errors = [];
  if (!Array.isArray(revisions)) return ["revisions must be an array"];

  const revisionIds = new Set();
  const numbersByDefinition = new Map();
  revisions.forEach((revision, index) => {
    errors.push(...validateBundleRevision(revision).map((error) => `revisions[${index}].${error}`));
    if (!isPlainObject(revision)) return;
    if (revisionIds.has(revision.revision_id)) errors.push(`duplicate revision_id "${revision.revision_id}"`);
    revisionIds.add(revision.revision_id);
    const numbers = numbersByDefinition.get(revision.bundle_definition_id) ?? new Set();
    if (numbers.has(revision.revision_number)) {
      errors.push(`duplicate revision_number ${revision.revision_number} for bundle_definition_id "${revision.bundle_definition_id}"`);
    }
    numbers.add(revision.revision_number);
    numbersByDefinition.set(revision.bundle_definition_id, numbers);
  });
  return errors;
}

export function validateBundleDomain({ definitions, revisions }) {
  const errors = [
    ...validateBundleDefinitionCollection(definitions),
    ...validateBundleRevisionCollection(revisions),
  ];
  if (!Array.isArray(definitions) || !Array.isArray(revisions)) return errors;

  const revisionsById = new Map(revisions.map((revision) => [revision.revision_id, revision]));
  definitions.forEach((definition, index) => {
    if (!isPlainObject(definition) || definition.active_revision_id === null) return;
    const activeRevision = revisionsById.get(definition.active_revision_id);
    if (!activeRevision) {
      errors.push(`definitions[${index}].active_revision_id does not reference a revision`);
      return;
    }
    if (activeRevision.bundle_definition_id !== definition.bundle_definition_id) {
      errors.push(`definitions[${index}].active_revision_id references another bundle definition`);
    }
    if (activeRevision.status !== "published") {
      errors.push(`definitions[${index}].active_revision_id must reference a published revision`);
    }
  });
  return errors;
}

export function assertValidBundleDefinition(definition) {
  assertNoErrors(validateBundleDefinition(definition));
}

export function assertValidBundleRevision(revision) {
  assertNoErrors(validateBundleRevision(revision));
}

export function assertValidPublicationAttempt(attempt) {
  assertNoErrors(validatePublicationAttempt(attempt));
}

export function assertValidBundleDomain(domain) {
  assertNoErrors(validateBundleDomain(domain));
}

function validateParentBinding(errors, binding, path) {
  if (!isPlainObject(binding)) {
    errors.push(`${path} must be an object`);
    return;
  }
  requirePattern(errors, `${path}.product_gid`, binding.product_gid, PRODUCT_GID_REGEX);
  requirePattern(errors, `${path}.variant_gid`, binding.variant_gid, PRODUCT_VARIANT_GID_REGEX);
}

function validateRuntimeSnapshotRef(errors, reference, path) {
  if (!isPlainObject(reference)) {
    errors.push(`${path} must be an object`);
    return;
  }
  requireEqual(errors, `${path}.schema_version`, reference.schema_version, BUNDLE_RUNTIME_SCHEMA_VERSION);
  requireEqual(
    errors,
    `${path}.checksum_algorithm`,
    reference.checksum_algorithm,
    RUNTIME_SNAPSHOT_HASH_ALGORITHM,
  );
  requirePattern(errors, `${path}.checksum`, reference.checksum, /^[0-9a-f]{8}$/i);
  requireInteger(errors, `${path}.configuration_version`, reference.configuration_version, { min: 1 });
}

function rejectBundleInstanceFields(errors, value, path) {
  for (const forbiddenKey of ["bundle_id", "_bundle_id"]) {
    if (Object.hasOwn(value, forbiddenKey)) {
      errors.push(`${path}.${forbiddenKey} is reserved for per-cart bundle instances`);
    }
  }
}

function assertNoErrors(errors) {
  if (errors.length > 0) throw new BundleDomainValidationError(errors);
}

function requireEqual(errors, path, actual, expected) {
  if (actual !== expected) errors.push(`${path} must be ${JSON.stringify(expected)}`);
}

function requireEnum(errors, path, value, values) {
  if (!values.has(value)) errors.push(`${path} must be one of ${Array.from(values).join(", ")}`);
}

function requirePattern(errors, path, value, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) errors.push(`${path} has invalid format`);
}

function requireInteger(errors, path, value, { min = undefined } = {}) {
  if (!Number.isInteger(value)) {
    errors.push(`${path} must be an integer`);
  } else if (min != null && value < min) {
    errors.push(`${path} must be >= ${min}`);
  }
}

function requireNonEmptyString(errors, path, value) {
  if (typeof value !== "string" || value.trim() === "") errors.push(`${path} must be a non-empty string`);
}

function requireIsoDate(errors, path, value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push(`${path} must be an ISO-compatible date string`);
  }
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
