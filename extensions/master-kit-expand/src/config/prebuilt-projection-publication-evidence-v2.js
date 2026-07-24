import { parseFixedPricePerUnitMinorUnitsV2 } from "./prebuilt-bundle-import.quantity-v2.js";
import {
  PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_CONTRACT_IDENTITY,
  PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_SCHEMA_VERSION,
  validatePrebuiltBundleExpandProjectionV2,
} from "./prebuilt-bundle-expand-projection-v2.js";

export const PREBUILT_PROJECTION_PUBLICATION_EVIDENCE_V2_CONTRACT_IDENTITY =
  "prebuilt_projection_publication_evidence.v2";
export const PREBUILT_PROJECTION_PUBLICATION_EVIDENCE_V2_SCHEMA_VERSION =
  PREBUILT_PROJECTION_PUBLICATION_EVIDENCE_V2_CONTRACT_IDENTITY;

export function buildPrebuiltProjectionPublicationEvidenceV2({ projection } = {}) {
  const evidence = expectedEvidence(projection);
  return Object.freeze({
    evidence: deepFreeze(evidence),
    projection,
  });
}

export function assertPrebuiltProjectionPublicationEvidenceV2(
  evidence,
  { projection } = {},
) {
  assertEvidenceTransportShape(evidence);
  const expected = expectedEvidence(projection);
  for (const field of [
    "schema_version",
    "contract_identity",
    "projection_schema_version",
    "projection_contract_identity",
    "checksum_algorithm",
    "bundle_definition_id",
    "published_revision_id",
    "source_snapshot_checksum",
    "projection_checksum",
    "parent_variant_gid",
    "parent_total_minor_units",
  ]) {
    if (evidence[field] !== expected[field]) {
      throw new Error(`Projection publication evidence V2 ${field} does not match`);
    }
  }
  if (!samePublicationComponents(evidence.components, expected.components)) {
    throw new Error("Projection publication evidence V2 components do not match");
  }
  return true;
}

function expectedEvidence(projection) {
  assertProjectionTransportShape(projection);
  const errors = validatePrebuiltBundleExpandProjectionV2(projection);
  if (errors.length > 0) {
    throw new Error(`Projection V2 is invalid: ${errors.join("; ")}`);
  }
  if (projection.components.some(
    (component) => component.variant_gid === projection.parent.variant_gid,
  )) {
    throw new Error("Projection V2 parent Variant must not also be a component Variant");
  }

  const components = projection.components.map((component) => ({
    sequence: component.sequence,
    variant_gid: component.variant_gid,
    quantity: component.quantity,
    fixed_price_per_unit_minor_units: parseFixedPricePerUnitMinorUnitsV2(
      component.fixed_price_per_unit,
      `components[${component.sequence - 1}].fixed_price_per_unit`,
    ),
  }));
  const parentTotalMinorUnits = parseFixedPricePerUnitMinorUnitsV2(
    projection.parent.fixed_price_per_unit,
    "parent.fixed_price_per_unit",
  );
  const calculatedTotal = components.reduce((total, component) => {
    const componentTotal = component.quantity * component.fixed_price_per_unit_minor_units;
    if (!Number.isSafeInteger(componentTotal) || !Number.isSafeInteger(total + componentTotal)) {
      throw new Error("Projection V2 component total exceeds safe integer precision");
    }
    return total + componentTotal;
  }, 0);
  if (calculatedTotal !== parentTotalMinorUnits) {
    throw new Error("Projection V2 parent total does not match quantity multiplied by per-unit prices");
  }

  return {
    schema_version: PREBUILT_PROJECTION_PUBLICATION_EVIDENCE_V2_SCHEMA_VERSION,
    contract_identity: PREBUILT_PROJECTION_PUBLICATION_EVIDENCE_V2_CONTRACT_IDENTITY,
    projection_schema_version: PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_SCHEMA_VERSION,
    projection_contract_identity: PREBUILT_BUNDLE_EXPAND_PROJECTION_V2_CONTRACT_IDENTITY,
    checksum_algorithm: projection.checksum_algorithm,
    bundle_definition_id: projection.bundle_definition_id,
    published_revision_id: projection.published_revision_id,
    source_snapshot_checksum: projection.source_snapshot_checksum,
    projection_checksum: projection.checksum,
    parent_variant_gid: projection.parent.variant_gid,
    parent_total_minor_units: parentTotalMinorUnits,
    components,
  };
}

function assertEvidenceTransportShape(evidence) {
  const validShape = hasExactOwnKeys(evidence, [
    "schema_version",
    "contract_identity",
    "projection_schema_version",
    "projection_contract_identity",
    "checksum_algorithm",
    "bundle_definition_id",
    "published_revision_id",
    "source_snapshot_checksum",
    "projection_checksum",
    "parent_variant_gid",
    "parent_total_minor_units",
    "components",
  ]) && isPlainArray(evidence.components)
    && evidence.components.every((component) => hasExactOwnKeys(component, [
      "sequence",
      "variant_gid",
      "quantity",
      "fixed_price_per_unit_minor_units",
    ]));
  if (!validShape) {
    throw new Error("Projection publication evidence V2 transport shape is invalid");
  }
  const strings = [
    "schema_version",
    "contract_identity",
    "projection_schema_version",
    "projection_contract_identity",
    "checksum_algorithm",
    "bundle_definition_id",
    "published_revision_id",
    "source_snapshot_checksum",
    "projection_checksum",
    "parent_variant_gid",
  ];
  const validPrimitives = strings.every((field) => typeof evidence[field] === "string")
    && isNonNegativeSafeInteger(evidence.parent_total_minor_units)
    && evidence.components.every((component) => (
      isPositiveSafeInteger(component.sequence)
      && typeof component.variant_gid === "string"
      && isPositiveSafeInteger(component.quantity)
      && isNonNegativeSafeInteger(component.fixed_price_per_unit_minor_units)
    ));
  if (!validPrimitives) {
    throw new Error("Projection publication evidence V2 primitive fields are invalid");
  }
}

function assertProjectionTransportShape(projection) {
  const valid = hasExactOwnKeys(projection, [
    "schema_version",
    "contract_identity",
    "checksum_algorithm",
    "bundle_definition_id",
    "published_revision_id",
    "source_snapshot_checksum",
    "parent",
    "components",
    "checksum",
  ])
    && hasExactOwnKeys(projection.parent, [
      "product_gid",
      "variant_gid",
      "sku",
      "title",
      "fixed_price_per_unit",
    ])
    && isPlainArray(projection.components)
    && projection.components.every((component) => (
      hasExactOwnKeys(component, [
        "sequence",
        "group",
        "role",
        "product_gid",
        "variant_gid",
        "sku",
        "title",
        "quantity",
        "fixed_price_per_unit",
        "source_identity",
        "audit_provenance",
      ])
      && hasExactOwnKeys(component.audit_provenance, [
        "source_system",
        "source_bundle_id",
        "source_record_checksum",
      ])
    ));
  if (!valid) {
    throw new Error("Projection V2 transport shape is invalid");
  }
  const validPrimitives = [
    projection.schema_version,
    projection.contract_identity,
    projection.checksum_algorithm,
    projection.bundle_definition_id,
    projection.published_revision_id,
    projection.source_snapshot_checksum,
    projection.checksum,
    projection.parent.product_gid,
    projection.parent.variant_gid,
    projection.parent.sku,
    projection.parent.title,
    projection.parent.fixed_price_per_unit,
  ].every((value) => typeof value === "string")
    && projection.components.every((component) => (
      Number.isSafeInteger(component.sequence)
      && Number.isSafeInteger(component.quantity)
      && [
        component.group,
        component.role,
        component.product_gid,
        component.variant_gid,
        component.sku,
        component.title,
        component.fixed_price_per_unit,
        component.source_identity,
        component.audit_provenance.source_system,
        component.audit_provenance.source_bundle_id,
        component.audit_provenance.source_record_checksum,
      ].every((value) => typeof value === "string")
    ));
  if (!validPrimitives) {
    throw new Error("Projection V2 primitive fields are invalid");
  }
}

function samePublicationComponents(left, right) {
  return left.length === right.length && left.every((component, index) => {
    const expected = right[index];
    return component.sequence === expected.sequence
      && component.variant_gid === expected.variant_gid
      && component.quantity === expected.quantity
      && component.fixed_price_per_unit_minor_units
        === expected.fixed_price_per_unit_minor_units;
  });
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasExactOwnKeys(value, expectedKeys) {
  if (!isPlainOwnObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
    });
}

function isPlainOwnObject(value) {
  return value != null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isPlainArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(value);
  const expectedKeys = [...value.keys()].map(String);
  return Array.isArray(value)
    && keys.length === expectedKeys.length + 1
    && keys.at(-1) === "length"
    && expectedKeys.every((key, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return keys[index] === key
        && descriptor?.enumerable === true
        && Object.hasOwn(descriptor, "value");
    });
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
