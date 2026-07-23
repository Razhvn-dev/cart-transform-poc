import {
  PRODUCT_GID_REGEX,
  PRODUCT_VARIANT_GID_REGEX,
  RUNTIME_SNAPSHOT_HASH_ALGORITHM,
  UUID_REGEX,
} from "./bundle-config.schema.js";
import {
  calculateSerializedValueChecksum,
  calculateStableValueChecksum,
} from "./bundle-runtime.checksum.js";

export const PREBUILT_BUNDLE_EXPAND_PROJECTION_SCHEMA_VERSION = "prebuilt_bundle_expand_projection.v1";

// Publication-time compiler for fixed pre-built selections. Checkout should
// consume this compact projection instead of resolving a complete Snapshot.
export function compilePrebuiltBundleExpandProjection({ mapping, resolved_candidate } = {}) {
  if (!isPlainObject(mapping) || !isPlainObject(resolved_candidate)) {
    return unavailable("PROJECTION_INPUT_INVALID");
  }

  const projectionBody = {
    schema_version: PREBUILT_BUNDLE_EXPAND_PROJECTION_SCHEMA_VERSION,
    checksum_algorithm: RUNTIME_SNAPSHOT_HASH_ALGORITHM,
    bundle_definition_id: mapping.bundle_definition_id,
    published_revision_id: mapping.published_revision_id,
    source_snapshot_checksum: mapping.snapshot_checksum,
    parent: {
      product_gid: resolved_candidate.parent?.product_gid,
      variant_gid: resolved_candidate.parent?.variant_gid,
      sku: resolved_candidate.parent?.sku ?? "",
      title: resolved_candidate.parent?.title,
    },
    components: (resolved_candidate.components ?? []).map((component) => ({
      sequence: component.sequence,
      group: component.componentGroup,
      role: component.componentRole,
      product_gid: component.productId,
      variant_gid: component.variantId,
      sku: component.sku,
      title: component.title,
      fixed_price_per_unit: component.fixedPricePerUnit,
    })),
  };
  const projection = {
    ...projectionBody,
    checksum: calculateStableValueChecksum(projectionBody),
  };
  const errors = validatePrebuiltBundleExpandProjection(projection);
  return errors.length > 0
    ? unavailable("PROJECTION_INVALID", errors)
    : deepFreeze({ status: "ready", projection });
}

export function validatePrebuiltBundleExpandProjection(projection) {
  const errors = [];
  if (!isPlainObject(projection)) return ["projection must be an object"];
  if (projection.schema_version !== PREBUILT_BUNDLE_EXPAND_PROJECTION_SCHEMA_VERSION) {
    errors.push("projection schema_version is invalid");
  }
  if (projection.checksum_algorithm !== RUNTIME_SNAPSHOT_HASH_ALGORITHM) {
    errors.push("projection checksum_algorithm is invalid");
  }
  if (!UUID_REGEX.test(projection.bundle_definition_id ?? "")) errors.push("bundle_definition_id is invalid");
  if (!UUID_REGEX.test(projection.published_revision_id ?? "")) errors.push("published_revision_id is invalid");
  if (!isNonEmptyString(projection.source_snapshot_checksum)) errors.push("source_snapshot_checksum is required");
  if (!isValidParent(projection.parent)) errors.push("parent is invalid");
  if (!Array.isArray(projection.components) || projection.components.length === 0) {
    errors.push("components must be a non-empty array");
  } else {
    projection.components.forEach((component, index) => {
      if (!isValidComponent(component, index + 1)) errors.push(`components[${index}] is invalid`);
    });
  }

  if (isNonEmptyString(projection.checksum)) {
    if (calculatePrebuiltBundleExpandProjectionChecksum(projection) !== projection.checksum) {
      errors.push("projection checksum is invalid");
    }
  } else {
    errors.push("projection checksum is required");
  }
  return errors;
}

export function isValidPrebuiltBundleExpandProjection(projection) {
  if (!isPlainObject(projection)
    || projection.schema_version !== PREBUILT_BUNDLE_EXPAND_PROJECTION_SCHEMA_VERSION
    || projection.checksum_algorithm !== RUNTIME_SNAPSHOT_HASH_ALGORITHM
    || !UUID_REGEX.test(projection.bundle_definition_id ?? "")
    || !UUID_REGEX.test(projection.published_revision_id ?? "")
    || !isNonEmptyString(projection.source_snapshot_checksum)
    || !isValidParent(projection.parent)
    || !Array.isArray(projection.components)
    || projection.components.length === 0
    || !isNonEmptyString(projection.checksum)) {
    return false;
  }
  for (let index = 0; index < projection.components.length; index += 1) {
    if (!isValidRuntimeComponent(projection.components[index], index + 1)) return false;
  }
  return calculatePrebuiltBundleExpandProjectionChecksum(projection) === projection.checksum;
}

export function calculatePrebuiltBundleExpandProjectionChecksum(projection) {
  const canonical = {
    bundle_definition_id: projection.bundle_definition_id,
    checksum_algorithm: projection.checksum_algorithm,
    components: (projection.components ?? []).map((component) => ({
      fixed_price_per_unit: component.fixed_price_per_unit,
      group: component.group,
      product_gid: component.product_gid,
      role: component.role,
      sequence: component.sequence,
      sku: component.sku,
      title: component.title,
      variant_gid: component.variant_gid,
    })),
    parent: {
      product_gid: projection.parent?.product_gid,
      sku: projection.parent?.sku,
      title: projection.parent?.title,
      variant_gid: projection.parent?.variant_gid,
    },
    published_revision_id: projection.published_revision_id,
    schema_version: projection.schema_version,
    source_snapshot_checksum: projection.source_snapshot_checksum,
  };
  return calculateSerializedValueChecksum(JSON.stringify(canonical));
}

function isValidParent(parent) {
  return isPlainObject(parent)
    && PRODUCT_GID_REGEX.test(parent.product_gid ?? "")
    && PRODUCT_VARIANT_GID_REGEX.test(parent.variant_gid ?? "")
    && isNonEmptyString(parent.title)
    && typeof parent.sku === "string";
}

function isValidComponent(component, expectedSequence) {
  return isPlainObject(component)
    && component.sequence === expectedSequence
    && isNonEmptyString(component.group)
    && isNonEmptyString(component.role)
    && PRODUCT_GID_REGEX.test(component.product_gid ?? "")
    && PRODUCT_VARIANT_GID_REGEX.test(component.variant_gid ?? "")
    && isNonEmptyString(component.sku)
    && isNonEmptyString(component.title)
    && /^\d+\.\d{2}$/.test(component.fixed_price_per_unit ?? "");
}

function isValidRuntimeComponent(component, expectedSequence) {
  return isPlainObject(component)
    && component.sequence === expectedSequence
    && isNonEmptyString(component.group)
    && isNonEmptyString(component.role)
    && PRODUCT_VARIANT_GID_REGEX.test(component.variant_gid ?? "")
    && /^\d+\.\d{2}$/.test(component.fixed_price_per_unit ?? "");
}

function unavailable(reason, errors = []) {
  return deepFreeze({ status: "unavailable", reason, errors: [...errors], projection: null });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
