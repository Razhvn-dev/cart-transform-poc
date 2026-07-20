import {
  PRODUCT_GID_REGEX,
  PRODUCT_VARIANT_GID_REGEX,
  UUID_REGEX,
} from "./bundle-config.schema.js";
import { stableSerialize, calculateRuntimeSnapshotChecksum } from "./bundle-runtime.checksum.js";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { resolveRuntimeBundleSelection } from "./bundle-runtime.resolver.js";

export const PREBUILT_BUNDLE_IMPORT_PLAN_SCHEMA_VERSION = "prebuilt_bundle_import_plan.v1";
export const PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION = "prebuilt_bundle_import_source.v1";
export const PREBUILT_BUNDLE_IMPORT_MAPPING_SCHEMA_VERSION = "prebuilt_bundle_import_mapping.v1";
export const PREBUILT_BUNDLE_PILOT_SCOPE_SCHEMA_VERSION = "prebuilt_bundle_pilot_scope.v1";

export const PREBUILT_IMPORT_RECORD_STATUSES = new Set([
  "ready_for_confirmation",
  "needs_review",
  "rejected",
]);

/**
 * Produces a deterministic, write-free import review plan. It deliberately
 * does not create Definitions/Revisions or invoke a persistence adapter.
 */
export function createPrebuiltBundleImportPlan({
  import_id,
  source_records,
  mappings,
  pilot_scope,
  existing_parent_variant_gids = [],
  existing_parent_bindings = [],
}) {
  const planIssues = [];
  validateImportId(planIssues, import_id);
  planIssues.push(...validatePilotScope(pilot_scope).map((message) => issue("INVALID_PILOT_SCOPE", "pilot_scope", message)));

  const sourceRecords = Array.isArray(source_records) ? source_records : [];
  const sourceIndexes = indexSourceRecords(sourceRecords, planIssues);
  const mappingIndexes = indexMappings(mappings, planIssues);
  const existingParentVariants = new Set(existing_parent_variant_gids);
  const existingParentBindings = new Map(existing_parent_bindings.map((binding) => [binding?.variant_gid, binding]));
  const claimedParentVariants = new Map();

  const records = sourceRecords
    .map((source, index) => createRecordPlan({
      source,
      index,
      mapping: mappingIndexes.get(sourceIdentity(source)),
      pilot_scope,
      existingParentVariants,
      existingParentBindings,
      claimedParentVariants,
    }))
    .sort((left, right) => left.source_identity.localeCompare(right.source_identity));

  for (const sourceIdentityValue of mappingIndexes.keys()) {
    if (!sourceIndexes.has(sourceIdentityValue)) {
      planIssues.push(issue("UNMATCHED_MAPPING", "mapping", `No source record exists for ${sourceIdentityValue}`));
    }
  }

  const summary = records.reduce((result, record) => {
    result.total += 1;
    result[record.status] += 1;
    return result;
  }, {
    total: 0,
    ready_for_confirmation: 0,
    needs_review: 0,
    rejected: 0,
  });

  const confirmation_payload = {
    import_id,
    pilot_scope_id: pilot_scope?.pilot_scope_id ?? null,
    records: records
      .filter((record) => record.status === "ready_for_confirmation")
      .map((record) => ({
        source_identity: record.source_identity,
        source_fingerprint: record.source_fingerprint,
        target_bundle_definition_id: record.target?.bundle_definition_id ?? null,
        target_fingerprint: record.target_fingerprint,
      })),
  };

  return deepFreeze({
    schema_version: PREBUILT_BUNDLE_IMPORT_PLAN_SCHEMA_VERSION,
    import_id,
    mode: "dry_run",
    requires_explicit_confirmation: true,
    confirmation_token: calculateRuntimeSnapshotChecksum(confirmation_payload),
    plan_issues: planIssues,
    summary,
    records,
  });
}

export function validatePilotScope(pilotScope) {
  const errors = [];
  if (!isPlainObject(pilotScope)) return ["pilot_scope must be an object"];
  if (pilotScope.schema_version !== PREBUILT_BUNDLE_PILOT_SCOPE_SCHEMA_VERSION) {
    errors.push(`pilot_scope.schema_version must be ${PREBUILT_BUNDLE_PILOT_SCOPE_SCHEMA_VERSION}`);
  }
  requireUuid(errors, "pilot_scope.pilot_scope_id", pilotScope.pilot_scope_id);
  requireNonEmptyString(errors, "pilot_scope.store_domain", pilotScope.store_domain);
  if (!Array.isArray(pilotScope.approved_product_series_keys) || pilotScope.approved_product_series_keys.length === 0) {
    errors.push("pilot_scope.approved_product_series_keys must be a non-empty array");
  }
  if (!Array.isArray(pilotScope.approved_parent_variant_gids) || pilotScope.approved_parent_variant_gids.length === 0) {
    errors.push("pilot_scope.approved_parent_variant_gids must be a non-empty array");
  } else {
    pilotScope.approved_parent_variant_gids.forEach((variantGid, index) => {
      if (!PRODUCT_VARIANT_GID_REGEX.test(variantGid)) {
        errors.push(`pilot_scope.approved_parent_variant_gids[${index}] has invalid format`);
      }
    });
  }
  return errors;
}

function createRecordPlan({
  source, index, mapping, pilot_scope, existingParentVariants, existingParentBindings, claimedParentVariants,
}) {
  const issues = [];
  validateSourceRecord(issues, source, index);
  const identity = sourceIdentity(source);
  const sourceFingerprint = fingerprintSource(source);
  const target = mapping?.target ?? null;
  const existingBinding = target?.parent_binding?.variant_gid
    ? existingParentBindings.get(target.parent_binding.variant_gid)
    : null;
  const existingTarget = existingBinding?.bundle_definition_id === target?.bundle_definition_id
    && existingBinding?.product_gid === target?.parent_binding?.product_gid;
  const plannedTarget = target ? {
    bundle_definition_id: target.bundle_definition_id,
    parent_binding: structuredClone(target.parent_binding),
    configuration: structuredClone(mapping.configuration),
    fixed_selections: structuredClone(mapping.fixed_selections),
  } : null;

  if (!mapping) {
    issues.push(issue("MAPPING_REQUIRED", "mapping", "A source bundle requires an explicit target mapping."));
  } else {
    validateMapping(issues, mapping);
    validateTargetAgainstSource(
      issues,
      source,
      mapping,
      pilot_scope,
      existingParentVariants,
      existingParentBindings,
      claimedParentVariants,
    );
    validateFixedComponentParity(issues, source, mapping);
  }

  const status = issues.some((item) => item.severity === "error")
    ? "rejected"
    : issues.length > 0
      ? "needs_review"
      : "ready_for_confirmation";

  return {
    source_identity: identity,
    source_fingerprint: sourceFingerprint,
    status,
    source: safeSourceSummary(source),
    target: plannedTarget,
    existing_target: existingTarget,
    target_fingerprint: plannedTarget
      ? calculateRuntimeSnapshotChecksum({ target: plannedTarget })
      : null,
    issues,
  };
}

function validateSourceRecord(issues, source, index) {
  const path = `source_records[${index}]`;
  if (!isPlainObject(source)) {
    issues.push(issue("INVALID_SOURCE", path, "Source record must be an object."));
    return;
  }
  if (source.schema_version !== PREBUILT_BUNDLE_IMPORT_SOURCE_SCHEMA_VERSION) {
    issues.push(issue("INVALID_SOURCE_SCHEMA", path, "Unexpected source schema version."));
  }
  for (const key of ["source_system", "source_bundle_id", "source_checksum", "product_series_key"]) {
    if (!isNonEmptyString(source[key])) issues.push(issue("INVALID_SOURCE", `${path}.${key}`, "Value is required."));
  }
  validateParentBinding(issues, source.parent_binding, `${path}.parent_binding`);
  if (!Array.isArray(source.components) || source.components.length === 0) {
    issues.push(issue("INVALID_SOURCE_COMPONENTS", `${path}.components`, "At least one component is required."));
    return;
  }
  source.components.forEach((component, componentIndex) => {
    if (!isPlainObject(component) || !PRODUCT_VARIANT_GID_REGEX.test(component.variant_gid)) {
      issues.push(issue("INVALID_SOURCE_COMPONENT", `${path}.components[${componentIndex}]`, "Component variant_gid is invalid."));
    }
    if (component?.quantity !== 1) {
      issues.push(issue("UNSUPPORTED_SOURCE_QUANTITY", `${path}.components[${componentIndex}]`, "Only quantity 1 components are supported by the current fixed-selection plan."));
    }
  });
}

function validateMapping(issues, mapping) {
  if (!isPlainObject(mapping)) {
    issues.push(issue("INVALID_MAPPING", "mapping", "Mapping must be an object."));
    return;
  }
  if (mapping.schema_version !== PREBUILT_BUNDLE_IMPORT_MAPPING_SCHEMA_VERSION) {
    issues.push(issue("INVALID_MAPPING_SCHEMA", "mapping.schema_version", "Unexpected mapping schema version."));
  }
  if (!isPlainObject(mapping.target)) {
    issues.push(issue("INVALID_TARGET", "mapping.target", "Target must be an object."));
    return;
  }
  requireUuidIssue(issues, "mapping.target.bundle_definition_id", mapping.target.bundle_definition_id);
  validateParentBinding(issues, mapping.target.parent_binding, "mapping.target.parent_binding");
  if (!isPlainObject(mapping.fixed_selections)) {
    issues.push(issue("INVALID_FIXED_SELECTIONS", "mapping.fixed_selections", "Fixed selections must be an object."));
  }
  if (!isPlainObject(mapping.configuration)) {
    issues.push(issue("CONFIGURATION_REQUIRED", "mapping.configuration", "A complete Bundle Config V1 document is required for dry-run parity."));
  }
}

function validateTargetAgainstSource(
  issues,
  source,
  mapping,
  pilotScope,
  existingParentVariants,
  existingParentBindings,
  claimedParentVariants,
) {
  const target = mapping.target;
  if (!isPlainObject(target)) return;
  const targetVariant = target.parent_binding?.variant_gid;
  if (!targetVariant) return;
  if (source.parent_binding?.variant_gid !== targetVariant || source.parent_binding?.product_gid !== target.parent_binding?.product_gid) {
    issues.push(issue("PARENT_BINDING_MISMATCH", "mapping.target.parent_binding", "Source and target parent binding must be identical."));
  }
  if (source.product_series_key && !pilotScope?.approved_product_series_keys?.includes(source.product_series_key)) {
    issues.push(issue("OUTSIDE_PILOT_SERIES", "source.product_series_key", "Source record is outside the approved pilot product series."));
  }
  if (!pilotScope?.approved_parent_variant_gids?.includes(targetVariant)) {
    issues.push(issue("OUTSIDE_PILOT_VARIANT", "mapping.target.parent_binding.variant_gid", "Target parent Variant is outside the approved pilot scope."));
  }
  const existingBinding = existingParentBindings.get(targetVariant);
  const exactExistingTarget = existingBinding?.bundle_definition_id === target.bundle_definition_id
    && existingBinding?.product_gid === target.parent_binding?.product_gid;
  if (existingParentVariants.has(targetVariant) && !exactExistingTarget) {
    issues.push(issue("EXISTING_PARENT_BINDING", "mapping.target.parent_binding.variant_gid", "A target BundleDefinition already owns this parent Variant."));
  }
  const previousSource = claimedParentVariants.get(targetVariant);
  if (previousSource && previousSource !== sourceIdentity(source)) {
    issues.push(issue("DUPLICATE_TARGET_PARENT", "mapping.target.parent_binding.variant_gid", `Also mapped by ${previousSource}.`));
  } else {
    claimedParentVariants.set(targetVariant, sourceIdentity(source));
  }
}

function validateFixedComponentParity(issues, source, mapping) {
  if (!isPlainObject(mapping?.configuration) || !isPlainObject(mapping?.fixed_selections)) return;
  try {
    const snapshot = compileRuntimeSnapshot(mapping.configuration);
    if (snapshot.configuration_id !== mapping.target?.bundle_definition_id) {
      issues.push(issue("CONFIGURATION_ID_MISMATCH", "mapping.configuration.configuration_id", "Configuration ID must match target BundleDefinition ID."));
      return;
    }
    if (snapshot.parent.variant_gid !== mapping.target?.parent_binding?.variant_gid) {
      issues.push(issue("CONFIGURATION_PARENT_MISMATCH", "mapping.configuration.parent", "Configuration parent binding must match mapping target."));
      return;
    }
    const resolved = resolveRuntimeBundleSelection(snapshot, selectionAttributes(snapshot, mapping.fixed_selections));
    const expected = source.components.map((component) => component.variant_gid);
    const actual = resolved.components.map((component) => component.variantId);
    if (stableSerialize(expected) !== stableSerialize(actual)) {
      issues.push(issue("COMPONENT_PARITY_MISMATCH", "mapping.fixed_selections", "Fixed selections do not resolve to the source component sequence."));
    }
  } catch (error) {
    issues.push(issue("CONFIGURATION_INVALID", "mapping.configuration", error.message));
  }
}

function selectionAttributes(snapshot, fixedSelections) {
  return snapshot.groups.reduce((attributes, group) => {
    const selectedOptionKey = fixedSelections[group.key];
    if (selectedOptionKey) attributes[group.cart_attribute] = selectedOptionKey;
    return attributes;
  }, {});
}

function indexSourceRecords(records, planIssues) {
  const index = new Map();
  if (!Array.isArray(records)) {
    planIssues.push(issue("INVALID_SOURCE_COLLECTION", "source_records", "Source records must be an array."));
    return index;
  }
  records.forEach((record, recordIndex) => {
    const identity = sourceIdentity(record);
    if (index.has(identity)) planIssues.push(issue("DUPLICATE_SOURCE", `source_records[${recordIndex}]`, `Duplicate source identity ${identity}.`));
    index.set(identity, record);
  });
  return index;
}

function indexMappings(mappings, planIssues) {
  const index = new Map();
  if (!Array.isArray(mappings)) {
    planIssues.push(issue("INVALID_MAPPING_COLLECTION", "mappings", "Mappings must be an array."));
    return index;
  }
  mappings.forEach((mapping, mappingIndex) => {
    const identity = mapping?.source_identity;
    if (!isNonEmptyString(identity)) {
      planIssues.push(issue("INVALID_MAPPING", `mappings[${mappingIndex}].source_identity`, "Source identity is required."));
      return;
    }
    if (index.has(identity)) planIssues.push(issue("DUPLICATE_MAPPING", `mappings[${mappingIndex}]`, `Duplicate mapping for ${identity}.`));
    index.set(identity, mapping);
  });
  return index;
}

function safeSourceSummary(source) {
  return {
    source_system: source?.source_system ?? null,
    source_bundle_id: source?.source_bundle_id ?? null,
    source_checksum: source?.source_checksum ?? null,
    product_series_key: source?.product_series_key ?? null,
    parent_binding: structuredClone(source?.parent_binding ?? null),
    component_variant_gids: Array.isArray(source?.components)
      ? source.components.map((component) => component?.variant_gid ?? null)
      : [],
  };
}

function sourceIdentity(source) {
  return `${source?.source_system ?? ""}:${source?.source_bundle_id ?? ""}`;
}

function fingerprintSource(source) {
  return calculateRuntimeSnapshotChecksum({ source: safeSourceSummary(source) });
}

function validateImportId(errors, importId) {
  if (typeof importId !== "string" || !UUID_REGEX.test(importId)) {
    errors.push(issue("INVALID_IMPORT_ID", "import_id", "Import ID must be a UUID."));
  }
}

function validateParentBinding(issues, parentBinding, path) {
  if (!isPlainObject(parentBinding)) {
    issues.push(issue("INVALID_PARENT_BINDING", path, "Parent binding must be an object."));
    return;
  }
  if (!PRODUCT_GID_REGEX.test(parentBinding.product_gid)) {
    issues.push(issue("INVALID_PARENT_PRODUCT", `${path}.product_gid`, "Product GID is invalid."));
  }
  if (!PRODUCT_VARIANT_GID_REGEX.test(parentBinding.variant_gid)) {
    issues.push(issue("INVALID_PARENT_VARIANT", `${path}.variant_gid`, "Variant GID is invalid."));
  }
}

function requireUuidIssue(issues, path, value) {
  if (typeof value !== "string" || !UUID_REGEX.test(value)) {
    issues.push(issue("INVALID_UUID", path, "Value must be a UUID."));
  }
}

function requireUuid(errors, path, value) {
  if (typeof value !== "string" || !UUID_REGEX.test(value)) errors.push(`${path} must be a UUID`);
}

function requireNonEmptyString(errors, path, value) {
  if (!isNonEmptyString(value)) errors.push(`${path} must be a non-empty string`);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function issue(code, path, message, severity = "error") {
  return { code, path, message, severity };
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
