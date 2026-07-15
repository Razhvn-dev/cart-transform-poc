import {
  BUNDLE_RUNTIME_SCHEMA_VERSION,
  CONDITION_OPERATORS,
  DISCOUNT_ALLOCATIONS,
  DISCOUNT_TYPES,
  KEY_REGEX,
  MEDIA_IMAGE_GID_REGEX,
  PRODUCT_GID_REGEX,
  PRODUCT_VARIANT_GID_REGEX,
  RULE_EFFECTS,
  RULE_MATCH_MODES,
  RUNTIME_SNAPSHOT_HASH_ALGORITHM,
  SLUG_REGEX,
  UUID_REGEX,
} from "./bundle-config.schema.js";
import { calculateRuntimeSnapshotChecksum } from "./bundle-runtime.checksum.js";

export class RuntimeSnapshotValidationError extends Error {
  constructor(errors) {
    super(`Runtime snapshot is invalid: ${errors.join("; ")}`);
    this.name = "RuntimeSnapshotValidationError";
    this.errors = errors;
  }
}

export function validateRuntimeSnapshot(snapshot) {
  const errors = [];

  if (!isPlainObject(snapshot)) return ["snapshot must be an object"];

  requireEqual(errors, "snapshot_schema", snapshot.snapshot_schema, BUNDLE_RUNTIME_SCHEMA_VERSION);
  requirePattern(errors, "configuration_id", snapshot.configuration_id, UUID_REGEX);
  requireInteger(errors, "configuration_version", snapshot.configuration_version, { min: 1 });
  requirePattern(errors, "slug", snapshot.slug, SLUG_REGEX);
  requireEqual(
    errors,
    "checksum_algorithm",
    snapshot.checksum_algorithm,
    RUNTIME_SNAPSHOT_HASH_ALGORITHM,
  );
  requireNonEmptyString(errors, "checksum", snapshot.checksum);

  validateParent(errors, snapshot.parent);
  validateGroups(errors, snapshot.groups);
  validateRules(errors, snapshot.rules, snapshot.groups);
  validatePresets(errors, snapshot.presets, snapshot.groups);
  validatePricing(errors, snapshot.pricing);
  validateMetadata(errors, snapshot.metadata);

  if (typeof snapshot.checksum === "string") {
    const expectedChecksum = calculateRuntimeSnapshotChecksum(snapshot);
    if (snapshot.checksum !== expectedChecksum) {
      errors.push("checksum does not match snapshot content");
    }
  }

  return errors;
}

export function assertValidRuntimeSnapshot(snapshot) {
  const errors = validateRuntimeSnapshot(snapshot);
  if (errors.length > 0) throw new RuntimeSnapshotValidationError(errors);
}

function validateParent(errors, parent) {
  if (!isPlainObject(parent)) {
    errors.push("parent must be an object");
    return;
  }

  requirePattern(errors, "parent.product_gid", parent.product_gid, PRODUCT_GID_REGEX);
  requirePattern(errors, "parent.variant_gid", parent.variant_gid, PRODUCT_VARIANT_GID_REGEX);
  requireNonEmptyString(errors, "parent.sku", parent.sku);
  requireNonEmptyString(errors, "parent.title", parent.title);
}

function validateGroups(errors, groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    errors.push("groups must be a non-empty array");
    return;
  }

  const groupKeys = new Set();

  groups.forEach((group, groupIndex) => {
    const path = `groups[${groupIndex}]`;
    if (!isPlainObject(group)) {
      errors.push(`${path} must be an object`);
      return;
    }

    requirePattern(errors, `${path}.key`, group.key, KEY_REGEX);
    if (groupKeys.has(group.key)) errors.push(`duplicate group key "${group.key}"`);
    groupKeys.add(group.key);
    requirePattern(errors, `${path}.role`, group.role, KEY_REGEX);
    requireInteger(errors, `${path}.order`, group.order);
    requireBoolean(errors, `${path}.required`, group.required);
    requireNonEmptyString(errors, `${path}.cart_attribute`, group.cart_attribute);
    requirePattern(errors, `${path}.default_option`, group.default_option, KEY_REGEX);

    if (!Array.isArray(group.options) || group.options.length === 0) {
      errors.push(`${path}.options must be a non-empty array`);
      return;
    }

    const optionKeys = new Set();
    group.options.forEach((option, optionIndex) => {
      validateOption(errors, option, `${path}.options[${optionIndex}]`);
      if (!isPlainObject(option)) return;
      if (optionKeys.has(option.key)) {
        errors.push(`duplicate option key "${option.key}" in group "${group.key}"`);
      }
      optionKeys.add(option.key);
    });

    if (!optionKeys.has(group.default_option)) {
      errors.push(`${path}.default_option must reference an option in the same group`);
    }
  });
}

function validateOption(errors, option, path) {
  if (!isPlainObject(option)) {
    errors.push(`${path} must be an object`);
    return;
  }

  requirePattern(errors, `${path}.key`, option.key, KEY_REGEX);
  requirePattern(errors, `${path}.product_gid`, option.product_gid, PRODUCT_GID_REGEX);
  requirePattern(errors, `${path}.variant_gid`, option.variant_gid, PRODUCT_VARIANT_GID_REGEX);
  requireNonEmptyString(errors, `${path}.sku`, option.sku);
  requireNonEmptyString(errors, `${path}.label`, option.label);
  requireInteger(errors, `${path}.price_cents`, option.price_cents, { min: 0 });
  if (option.media_gid != null) {
    requirePattern(errors, `${path}.media_gid`, option.media_gid, MEDIA_IMAGE_GID_REGEX);
  }
  requireInteger(errors, `${path}.order`, option.order);
  requirePattern(errors, `${path}.metadata_role`, option.metadata_role, KEY_REGEX);
}

function validateRules(errors, rules, groups) {
  if (!Array.isArray(rules)) {
    errors.push("rules must be an array");
    return;
  }

  const groupMap = buildGroupMap(groups);
  const ruleIds = new Set();

  rules.forEach((rule, index) => {
    const path = `rules[${index}]`;
    if (!isPlainObject(rule)) {
      errors.push(`${path} must be an object`);
      return;
    }

    requirePattern(errors, `${path}.id`, rule.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    if (ruleIds.has(rule.id)) errors.push(`duplicate rule id "${rule.id}"`);
    ruleIds.add(rule.id);
    requireInteger(errors, `${path}.order`, rule.order);
    requireEnum(errors, `${path}.effect`, rule.effect, RULE_EFFECTS);
    requireEnum(errors, `${path}.match`, rule.match, RULE_MATCH_MODES);
    validateConditions(errors, rule.when, `${path}.when`, groupMap);
    validateRuleTarget(errors, rule, path, groupMap);
  });
}

function validateConditions(errors, conditions, path, groupMap) {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }

  conditions.forEach((condition, index) => {
    const conditionPath = `${path}[${index}]`;
    if (!isPlainObject(condition)) {
      errors.push(`${conditionPath} must be an object`);
      return;
    }

    requireGroupOption(errors, conditionPath, condition.group, condition.option, groupMap);
    requireEnum(errors, `${conditionPath}.operator`, condition.operator, CONDITION_OPERATORS);
  });
}

function validateRuleTarget(errors, rule, path, groupMap) {
  if (!isPlainObject(rule.target)) {
    errors.push(`${path}.target must be an object`);
    return;
  }

  const targetGroup = groupMap.get(rule.target.group);
  if (!targetGroup) {
    errors.push(`${path}.target.group references an unknown group`);
    return;
  }

  if (rule.target.option != null) {
    requireGroupOption(errors, `${path}.target`, rule.target.group, rule.target.option, groupMap);
  }

  for (const key of ["allowed_options", "denied_options", "required_options"]) {
    if (rule[key] == null) continue;
    if (!Array.isArray(rule[key])) {
      errors.push(`${path}.${key} must be an array when provided`);
      continue;
    }
    rule[key].forEach((optionKey) => {
      if (!targetGroup.optionKeys.has(optionKey)) {
        errors.push(`${path}.${key} references unknown option "${optionKey}"`);
      }
    });
  }

  if (rule.fallback_option != null && !targetGroup.optionKeys.has(rule.fallback_option)) {
    errors.push(`${path}.fallback_option references an unknown option`);
  }

  if (rule.effect === "visibility") {
    requireBoolean(errors, `${path}.visible`, rule.visible);
    requireBoolean(errors, `${path}.component_included`, rule.component_included);
  }
}

function validatePresets(errors, presets, groups) {
  if (!Array.isArray(presets)) {
    errors.push("presets must be an array");
    return;
  }

  const groupMap = buildGroupMap(groups);
  const presetIds = new Set();

  presets.forEach((preset, index) => {
    const path = `presets[${index}]`;
    if (!isPlainObject(preset)) {
      errors.push(`${path} must be an object`);
      return;
    }

    requirePattern(errors, `${path}.id`, preset.id, KEY_REGEX);
    if (presetIds.has(preset.id)) errors.push(`duplicate preset id "${preset.id}"`);
    presetIds.add(preset.id);
    requireNonEmptyString(errors, `${path}.label`, preset.label);
    requireInteger(errors, `${path}.order`, preset.order);

    if (!isPlainObject(preset.selections)) {
      errors.push(`${path}.selections must be an object`);
      return;
    }

    Object.entries(preset.selections).forEach(([groupKey, optionKey]) => {
      requireGroupOption(errors, `${path}.selections.${groupKey}`, groupKey, optionKey, groupMap);
    });

    if (preset.media_gid != null) {
      requirePattern(errors, `${path}.media_gid`, preset.media_gid, MEDIA_IMAGE_GID_REGEX);
    }
  });
}

function validatePricing(errors, pricing) {
  if (!isPlainObject(pricing)) {
    errors.push("pricing must be an object");
    return;
  }

  requireInteger(errors, "pricing.base_price_cents", pricing.base_price_cents, { min: 0 });
  if (!isPlainObject(pricing.discount)) {
    errors.push("pricing.discount must be an object");
    return;
  }

  requireEnum(errors, "pricing.discount.type", pricing.discount.type, DISCOUNT_TYPES);
  requireInteger(errors, "pricing.discount.basis_points", pricing.discount.basis_points, {
    min: 0,
    max: 10000,
  });
  requireEnum(
    errors,
    "pricing.discount.allocation",
    pricing.discount.allocation,
    DISCOUNT_ALLOCATIONS,
  );
}

function validateMetadata(errors, metadata) {
  if (!isPlainObject(metadata)) {
    errors.push("metadata must be an object");
    return;
  }

  requireEqual(errors, "metadata.bundle_contract_version", metadata.bundle_contract_version, "1");
  requireBoolean(errors, "metadata.emit_component_group", metadata.emit_component_group);
  requireBoolean(errors, "metadata.emit_component_role", metadata.emit_component_role);
  requireBoolean(errors, "metadata.emit_component_sequence", metadata.emit_component_sequence);

  if (!Array.isArray(metadata.future_fields)) {
    errors.push("metadata.future_fields must be an array");
    return;
  }

  metadata.future_fields.forEach((field) => {
    requireNonEmptyString(errors, "metadata.future_fields[]", field);
  });
}

function buildGroupMap(groups) {
  const map = new Map();
  if (!Array.isArray(groups)) return map;

  groups.forEach((group) => {
    if (!isPlainObject(group) || !Array.isArray(group.options)) return;
    map.set(group.key, {
      optionKeys: new Set(group.options.map((option) => option.key)),
    });
  });

  return map;
}

function requireGroupOption(errors, path, groupKey, optionKey, groupMap) {
  const group = groupMap.get(groupKey);
  if (!group) {
    errors.push(`${path}.group references unknown group "${groupKey}"`);
    return;
  }
  if (!group.optionKeys.has(optionKey)) {
    errors.push(`${path}.option references unknown option "${optionKey}"`);
  }
}

function requireEqual(errors, path, actual, expected) {
  if (actual !== expected) errors.push(`${path} must be ${JSON.stringify(expected)}`);
}

function requireEnum(errors, path, value, values) {
  if (!values.has(value)) errors.push(`${path} must be one of ${Array.from(values).join(", ")}`);
}

function requirePattern(errors, path, value, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    errors.push(`${path} has invalid format`);
  }
}

function requireNonEmptyString(errors, path, value) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${path} must be a non-empty string`);
  }
}

function requireInteger(errors, path, value, { min = undefined, max = undefined } = {}) {
  if (!Number.isInteger(value)) {
    errors.push(`${path} must be an integer`);
    return;
  }
  if (min != null && value < min) errors.push(`${path} must be >= ${min}`);
  if (max != null && value > max) errors.push(`${path} must be <= ${max}`);
}

function requireBoolean(errors, path, value) {
  if (typeof value !== "boolean") errors.push(`${path} must be a boolean`);
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
