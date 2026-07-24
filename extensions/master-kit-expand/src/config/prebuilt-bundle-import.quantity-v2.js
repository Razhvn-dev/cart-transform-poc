import { PRODUCT_VARIANT_GID_REGEX } from "./bundle-config.schema.js";

export const PREBUILT_BUNDLE_IMPORT_QUANTITY_V2_CONTRACT_IDENTITY = "prebuilt_bundle_import_quantity.v2";
export const MAX_PREBUILT_COMPONENT_QUANTITY_V2 = 2_147_483_647;

export class PrebuiltBundleImportQuantityV2Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PrebuiltBundleImportQuantityV2Error";
    this.code = code;
  }
}

export function normalizePrebuiltBundleImportQuantityV2Components(components) {
  if (!Array.isArray(components) || components.length === 0) {
    throw invalid("INVALID_COMPONENTS", "components must be a non-empty array");
  }

  const byVariant = new Map();
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (!isPlainObject(component)) {
      throw invalid("INVALID_COMPONENT", `components[${index}] must be an object`);
    }
    if (!PRODUCT_VARIANT_GID_REGEX.test(component.variantId ?? "")) {
      throw invalid("INVALID_VARIANT_ID", `components[${index}].variantId is invalid`);
    }
    if (!Number.isSafeInteger(component.quantity)
      || component.quantity <= 0
      || component.quantity > MAX_PREBUILT_COMPONENT_QUANTITY_V2) {
      throw invalid(
        "INVALID_QUANTITY",
        `components[${index}].quantity must be an integer from 1 through ${MAX_PREBUILT_COMPONENT_QUANTITY_V2}`,
      );
    }
    parseFixedPricePerUnitMinorUnitsV2(component.fixedPricePerUnit, `components[${index}].fixedPricePerUnit`);
    if (!isNonEmptyString(component.sourceIdentity)) {
      throw invalid("INVALID_SOURCE_IDENTITY", `components[${index}].sourceIdentity must be a non-empty string`);
    }
    if (!isValidAuditProvenance(component.auditProvenance)) {
      throw invalid(
        "INVALID_AUDIT_PROVENANCE",
        `components[${index}].auditProvenance must contain only sourceSystem, sourceBundleId, and sourceRecordChecksum`,
      );
    }

    const existing = byVariant.get(component.variantId);
    if (!existing) {
      byVariant.set(component.variantId, {
        variantId: component.variantId,
        quantity: component.quantity,
        fixedPricePerUnit: component.fixedPricePerUnit,
        sourceIdentity: component.sourceIdentity,
        auditProvenance: { ...component.auditProvenance },
      });
      continue;
    }
    if (existing.fixedPricePerUnit !== component.fixedPricePerUnit) {
      throw invalid(
        "DUPLICATE_VARIANT_PRICE_CONFLICT",
        `components[${index}] conflicts with the existing unit price for ${component.variantId}`,
      );
    }
    if (existing.sourceIdentity !== component.sourceIdentity) {
      throw invalid(
        "DUPLICATE_VARIANT_SOURCE_CONFLICT",
        `components[${index}] conflicts with the existing source identity for ${component.variantId}`,
      );
    }
    if (!sameAuditProvenance(existing.auditProvenance, component.auditProvenance)) {
      throw invalid(
        "DUPLICATE_VARIANT_PROVENANCE_CONFLICT",
        `components[${index}] conflicts with the existing audit provenance for ${component.variantId}`,
      );
    }
    const quantity = existing.quantity + component.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > MAX_PREBUILT_COMPONENT_QUANTITY_V2) {
      throw invalid(
        "QUANTITY_OVERFLOW",
        `aggregated quantity for ${component.variantId} exceeds ${MAX_PREBUILT_COMPONENT_QUANTITY_V2}`,
      );
    }
    existing.quantity = quantity;
  }

  return deepFreeze([...byVariant.values()]);
}

export function parseFixedPricePerUnitMinorUnitsV2(value, field = "fixedPricePerUnit") {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)\.\d{2}$/.test(value)) {
    throw invalid(
      "INVALID_FIXED_PRICE_PER_UNIT",
      `${field} must be a canonical non-negative decimal string with two digits of precision`,
    );
  }
  const [whole, fraction] = value.split(".");
  const wholeMinorUnits = Number(whole) * 100;
  const minorUnits = wholeMinorUnits + Number(fraction);
  if (!Number.isSafeInteger(wholeMinorUnits) || !Number.isSafeInteger(minorUnits)) {
    throw invalid("INVALID_FIXED_PRICE_PER_UNIT", `${field} exceeds safe minor-unit precision`);
  }
  return minorUnits;
}

function invalid(code, message) {
  return new PrebuiltBundleImportQuantityV2Error(code, message);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isValidAuditProvenance(value) {
  const fields = ["sourceSystem", "sourceBundleId", "sourceRecordChecksum"];
  return isPlainObject(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => isNonEmptyString(value[field]));
}

function sameAuditProvenance(left, right) {
  return left.sourceSystem === right.sourceSystem
    && left.sourceBundleId === right.sourceBundleId
    && left.sourceRecordChecksum === right.sourceRecordChecksum;
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
