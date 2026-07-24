import {
  PRODUCT_GID_REGEX,
  PRODUCT_VARIANT_GID_REGEX,
  RUNTIME_SNAPSHOT_HASH_ALGORITHM,
  UUID_REGEX,
} from "./bundle-config.schema.js";
import { calculateSerializedValueChecksum } from "./bundle-runtime.checksum.js";
import {
  MAX_PREBUILT_COMPONENT_QUANTITY_V2,
  parseFixedPricePerUnitMinorUnitsV2,
} from "./prebuilt-bundle-import.quantity-v2.js";

export const PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_CONTRACT_IDENTITY = "prebuilt_bundle_expand_projection.v2";
export const PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_SCHEMA_VERSION = PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_CONTRACT_IDENTITY;

export function compilePrebuiltBundleExpandProjectionV2({
  mapping,
  resolved_candidate,
  parent_fixed_price_per_unit,
} = {}) {
  if (!isPlainObject(mapping) || !isPlainObject(resolved_candidate)) {
    return unavailable("PROJECTION_INPUT_INVALID");
  }
  if (!Array.isArray(resolved_candidate.components)
    || resolved_candidate.components.some((component) => !isPlainObject(component))) {
    return unavailable("PROJECTION_INPUT_INVALID", ["resolved_candidate.components is invalid"]);
  }

  const projectionBody = {
    schema_version: PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_SCHEMA_VERSION,
    contract_identity: PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_CONTRACT_IDENTITY,
    checksum_algorithm: RUNTIME_SNAPSHOT_HASH_ALGORITHM,
    bundle_definition_id: mapping.bundle_definition_id,
    published_revision_id: mapping.published_revision_id,
    source_snapshot_checksum: mapping.snapshot_checksum,
    parent: {
      product_gid: resolved_candidate.parent?.product_gid,
      variant_gid: resolved_candidate.parent?.variant_gid,
      sku: resolved_candidate.parent?.sku ?? "",
      title: resolved_candidate.parent?.title,
      fixed_price_per_unit: parent_fixed_price_per_unit,
    },
    components: resolved_candidate.components.map((component) => ({
      sequence: component.sequence,
      group: component.componentGroup,
      role: component.componentRole,
      product_gid: component.productId,
      variant_gid: component.variantId,
      sku: component.sku,
      title: component.title,
      quantity: component.quantity,
      fixed_price_per_unit: component.fixedPricePerUnit,
      source_identity: component.sourceIdentity,
      audit_provenance: {
        source_system: component.auditProvenance?.sourceSystem,
        source_bundle_id: component.auditProvenance?.sourceBundleId,
        source_record_checksum: component.auditProvenance?.sourceRecordChecksum,
      },
    })),
  };
  try {
    const projection = {
      ...projectionBody,
      checksum: calculatePrebuiltBundleExpandProjectionV2Checksum(projectionBody),
    };
    const errors = validatePrebuiltBundleExpandProjectionV2(projection);
    return errors.length > 0
      ? unavailable("PROJECTION_INVALID", errors)
      : deepFreeze({ status: "ready", projection });
  } catch {
    return unavailable("PROJECTION_INVALID", ["projection contains non-JSON-safe values"]);
  }
}

export function validatePrebuiltBundleExpandProjectionV2(projection) {
  const errors = [];
  if (!isPlainObject(projection)) return ["projection must be an object"];
  if (projection.schema_version !== PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_SCHEMA_VERSION) {
    errors.push("projection schema_version is invalid");
  }
  if (projection.contract_identity !== PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_CONTRACT_IDENTITY) {
    errors.push("projection contract_identity is invalid");
  }
  if (projection.checksum_algorithm !== RUNTIME_SNAPSHOT_HASH_ALGORITHM) {
    errors.push("projection checksum_algorithm is invalid");
  }
  if (!UUID_REGEX.test(projection.bundle_definition_id ?? "")) {
    errors.push("bundle_definition_id is invalid");
  }
  if (!UUID_REGEX.test(projection.published_revision_id ?? "")) {
    errors.push("published_revision_id is invalid");
  }
  if (!isNonEmptyString(projection.source_snapshot_checksum)) {
    errors.push("source_snapshot_checksum is required");
  }

  let parentMinorUnits = null;
  if (!isValidParentIdentity(projection.parent)) {
    errors.push("parent is invalid");
  }
  try {
    parentMinorUnits = parseFixedPricePerUnitMinorUnitsV2(
      projection.parent?.fixed_price_per_unit,
      "parent.fixed_price_per_unit",
    );
  } catch {
    errors.push("parent.fixed_price_per_unit is invalid");
  }

  const seenVariants = new Set();
  let componentTotalMinorUnits = 0;
  let componentTotalValid = true;
  if (!Array.isArray(projection.components) || projection.components.length === 0) {
    errors.push("components must be a non-empty array");
    componentTotalValid = false;
  } else {
    projection.components.forEach((component, index) => {
      if (!isValidComponentIdentity(component, index + 1)) {
        errors.push(`components[${index}] is invalid`);
      }
      if (seenVariants.has(component?.variant_gid)) {
        errors.push(`components[${index}] has duplicate variant_gid ${component.variant_gid}`);
      } else if (typeof component?.variant_gid === "string") {
        seenVariants.add(component.variant_gid);
      }
      if (!isValidQuantityV2(component?.quantity)) {
        errors.push(
          `components[${index}].quantity must be an integer from 1 through ${MAX_PREBUILT_COMPONENT_QUANTITY_V2}`,
        );
        componentTotalValid = false;
      }

      let unitMinorUnits = null;
      try {
        unitMinorUnits = parseFixedPricePerUnitMinorUnitsV2(
          component?.fixed_price_per_unit,
          `components[${index}].fixed_price_per_unit`,
        );
      } catch {
        errors.push(`components[${index}].fixed_price_per_unit is invalid`);
        componentTotalValid = false;
      }
      if (unitMinorUnits === null || !isValidQuantityV2(component?.quantity)) return;

      const componentMinorUnits = unitMinorUnits * component.quantity;
      if (!Number.isSafeInteger(componentMinorUnits)) {
        errors.push(`components[${index}] quantity-price multiplication overflow`);
        componentTotalValid = false;
        return;
      }
      const nextTotal = componentTotalMinorUnits + componentMinorUnits;
      if (!Number.isSafeInteger(nextTotal)) {
        errors.push("component total summation overflow");
        componentTotalValid = false;
        return;
      }
      componentTotalMinorUnits = nextTotal;
    });
  }

  if (parentMinorUnits !== null && componentTotalValid && componentTotalMinorUnits !== parentMinorUnits) {
    errors.push("component total does not match parent fixed_price_per_unit");
  }
  if (!isNonEmptyString(projection.checksum)) {
    errors.push("projection checksum is required");
  } else if (calculatePrebuiltBundleExpandProjectionV2Checksum(projection) !== projection.checksum) {
    errors.push("projection checksum is invalid");
  }
  return errors;
}

export function isValidPrebuiltBundleExpandProjectionV2(projection) {
  try {
    return validatePrebuiltBundleExpandProjectionV2(projection).length === 0;
  } catch {
    return false;
  }
}

export function calculatePrebuiltBundleExpandProjectionV2Checksum(projection) {
  const components = Array.isArray(projection?.components) ? projection.components : [];
  const canonical = {
    bundle_definition_id: projection?.bundle_definition_id,
    checksum_algorithm: projection?.checksum_algorithm,
    components: components.map((component) => ({
      audit_provenance: {
        source_bundle_id: component?.audit_provenance?.source_bundle_id,
        source_record_checksum: component?.audit_provenance?.source_record_checksum,
        source_system: component?.audit_provenance?.source_system,
      },
      fixed_price_per_unit: component?.fixed_price_per_unit,
      group: component?.group,
      product_gid: component?.product_gid,
      quantity: component?.quantity,
      role: component?.role,
      sequence: component?.sequence,
      sku: component?.sku,
      source_identity: component?.source_identity,
      title: component?.title,
      variant_gid: component?.variant_gid,
    })),
    contract_identity: projection?.contract_identity,
    parent: {
      fixed_price_per_unit: projection?.parent?.fixed_price_per_unit,
      product_gid: projection?.parent?.product_gid,
      sku: projection?.parent?.sku,
      title: projection?.parent?.title,
      variant_gid: projection?.parent?.variant_gid,
    },
    published_revision_id: projection?.published_revision_id,
    schema_version: projection?.schema_version,
    source_snapshot_checksum: projection?.source_snapshot_checksum,
  };
  return calculateSerializedValueChecksum(JSON.stringify(canonical));
}

function isValidParentIdentity(parent) {
  return isPlainObject(parent)
    && PRODUCT_GID_REGEX.test(parent.product_gid ?? "")
    && PRODUCT_VARIANT_GID_REGEX.test(parent.variant_gid ?? "")
    && isNonEmptyString(parent.title)
    && typeof parent.sku === "string";
}

function isValidComponentIdentity(component, expectedSequence) {
  return isPlainObject(component)
    && component.sequence === expectedSequence
    && isNonEmptyString(component.group)
    && isNonEmptyString(component.role)
    && PRODUCT_GID_REGEX.test(component.product_gid ?? "")
    && PRODUCT_VARIANT_GID_REGEX.test(component.variant_gid ?? "")
    && isNonEmptyString(component.sku)
    && isNonEmptyString(component.title)
    && isNonEmptyString(component.source_identity)
    && isValidAuditProvenance(component.audit_provenance);
}

function isValidAuditProvenance(value) {
  const fields = ["source_system", "source_bundle_id", "source_record_checksum"];
  return isPlainObject(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => isNonEmptyString(value[field]));
}

function isValidQuantityV2(value) {
  return Number.isSafeInteger(value)
    && value > 0
    && value <= MAX_PREBUILT_COMPONENT_QUANTITY_V2;
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
