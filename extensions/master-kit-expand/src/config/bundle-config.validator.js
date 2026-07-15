import {
  BUNDLE_CONFIG_SCHEMA_VERSION,
  CART_PARENT_LINE_MODES,
  CHECKOUT_LINE_MODES,
  CONDITION_OPERATORS,
  CONFIG_STATUSES,
  DISCOUNT_ALLOCATIONS,
  DISCOUNT_TYPES,
  KEY_REGEX,
  MEDIA_IMAGE_GID_REGEX,
  PRODUCT_GID_REGEX,
  PRODUCT_VARIANT_GID_REGEX,
  RULE_EFFECTS,
  RULE_MATCH_MODES,
  SELECTION_UI_TYPES,
  SLUG_REGEX,
  UUID_REGEX,
  VARIANT_SELECTION_STRATEGIES,
} from "./bundle-config.schema.js";

export class BundleConfigValidationError extends Error {
  constructor(errors) {
    super(`Bundle configuration is invalid: ${errors.join("; ")}`);
    this.name = "BundleConfigValidationError";
    this.errors = errors;
  }
}

export function validateBundleConfig(config) {
  const errors = [];

  if (!isPlainObject(config)) {
    return ["configuration must be an object"];
  }

  requireEqual(errors, "schema_version", config.schema_version, BUNDLE_CONFIG_SCHEMA_VERSION);
  requirePattern(errors, "configuration_id", config.configuration_id, UUID_REGEX);
  requirePattern(errors, "slug", config.slug, SLUG_REGEX);
  requireInteger(errors, "configuration_version", config.configuration_version, { min: 1 });
  requireEnum(errors, "status", config.status, CONFIG_STATUSES);
  requireIsoDate(errors, "effective_from", config.effective_from);
  if (config.effective_to !== null) requireIsoDate(errors, "effective_to", config.effective_to);

  validateParent(errors, config.parent);
  validateSelection(errors, config.selection);
  validateGroups(errors, config.component_groups);
  validateRules(errors, config.compatibility_rules, config.component_groups);
  validatePresets(errors, config.presets, config.component_groups);
  validatePricing(errors, config.pricing);
  validateMetadata(errors, config.metadata);
  validateRevision(errors, config.revision);

  return errors;
}

export function assertValidBundleConfig(config) {
  const errors = validateBundleConfig(config);
  if (errors.length > 0) throw new BundleConfigValidationError(errors);
}

function validateParent(errors, parent) {
  if (!isPlainObject(parent)) {
    errors.push("parent must be an object");
    return;
  }

  requirePattern(errors, "parent.product_gid", parent.product_gid, PRODUCT_GID_REGEX);
  requirePattern(errors, "parent.variant_gid", parent.variant_gid, PRODUCT_VARIANT_GID_REGEX);
  requireEnum(
    errors,
    "parent.variant_selection_strategy",
    parent.variant_selection_strategy,
    VARIANT_SELECTION_STRATEGIES,
  );
  requireNonEmptyString(errors, "parent.sku", parent.sku);
  requireNonEmptyString(errors, "parent.title", parent.title);
  requireNonEmptyString(errors, "parent.template_handle", parent.template_handle);
}

function validateSelection(errors, selection) {
  if (!isPlainObject(selection)) {
    errors.push("selection must be an object");
    return;
  }

  requireInteger(errors, "selection.cart_quantity", selection.cart_quantity, { min: 1 });
  requireEnum(
    errors,
    "selection.cart_parent_line_mode",
    selection.cart_parent_line_mode,
    CART_PARENT_LINE_MODES,
  );
  requireEnum(
    errors,
    "selection.checkout_line_mode",
    selection.checkout_line_mode,
    CHECKOUT_LINE_MODES,
  );
}

function validateGroups(errors, groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    errors.push("component_groups must be a non-empty array");
    return;
  }

  const groupKeys = new Set();

  groups.forEach((group, groupIndex) => {
    const path = `component_groups[${groupIndex}]`;
    if (!isPlainObject(group)) {
      errors.push(`${path} must be an object`);
      return;
    }

    requirePattern(errors, `${path}.group_key`, group.group_key, KEY_REGEX);
    if (groupKeys.has(group.group_key)) errors.push(`duplicate group_key "${group.group_key}"`);
    groupKeys.add(group.group_key);

    requirePattern(errors, `${path}.slot`, group.slot, KEY_REGEX);
    requireNonEmptyString(errors, `${path}.label`, group.label);
    requirePattern(errors, `${path}.role`, group.role, KEY_REGEX);
    requireInteger(errors, `${path}.display_order`, group.display_order);
    requireBoolean(errors, `${path}.required`, group.required);
    requireInteger(errors, `${path}.min`, group.min, { min: 0 });
    requireInteger(errors, `${path}.max`, group.max, { min: group.min ?? 0 });
    requireEnum(errors, `${path}.ui_type`, group.ui_type, SELECTION_UI_TYPES);
    requireNonEmptyString(errors, `${path}.cart_attribute`, group.cart_attribute);
    requirePattern(errors, `${path}.default_option_key`, group.default_option_key, KEY_REGEX);

    if (!Array.isArray(group.options) || group.options.length === 0) {
      errors.push(`${path}.options must be a non-empty array`);
      return;
    }

    const optionKeys = new Set();
    const activeOptionKeys = new Set();

    group.options.forEach((option, optionIndex) => {
      validateOption(errors, option, `${path}.options[${optionIndex}]`);
      if (!isPlainObject(option)) return;

      if (optionKeys.has(option.option_key)) {
        errors.push(`duplicate option_key "${option.option_key}" in group "${group.group_key}"`);
      }
      optionKeys.add(option.option_key);
      if (option.active) activeOptionKeys.add(option.option_key);
    });

    if (!optionKeys.has(group.default_option_key)) {
      errors.push(`${path}.default_option_key must reference an option in the same group`);
    } else if (!activeOptionKeys.has(group.default_option_key)) {
      errors.push(`${path}.default_option_key must reference an active option`);
    }

    if (group.required && activeOptionKeys.size === 0) {
      errors.push(`${path} is required but has no active options`);
    }
  });
}

function validateOption(errors, option, path) {
  if (!isPlainObject(option)) {
    errors.push(`${path} must be an object`);
    return;
  }

  requirePattern(errors, `${path}.option_key`, option.option_key, KEY_REGEX);
  requirePattern(errors, `${path}.product_gid`, option.product_gid, PRODUCT_GID_REGEX);
  requirePattern(errors, `${path}.variant_gid`, option.variant_gid, PRODUCT_VARIANT_GID_REGEX);
  requireNonEmptyString(errors, `${path}.sku`, option.sku);
  requireNonEmptyString(errors, `${path}.label`, option.label);
  requireBoolean(errors, `${path}.active`, option.active);
  requireInteger(errors, `${path}.sort_order`, option.sort_order);
  requireInteger(errors, `${path}.price_cents_snapshot`, option.price_cents_snapshot, { min: 0 });
  if (option.media_gid != null) {
    requirePattern(errors, `${path}.media_gid`, option.media_gid, MEDIA_IMAGE_GID_REGEX);
  }
  requirePattern(errors, `${path}.metadata_role`, option.metadata_role, KEY_REGEX);
}

function validateRules(errors, rules, groups) {
  if (!Array.isArray(rules)) {
    errors.push("compatibility_rules must be an array");
    return;
  }

  const groupMap = buildGroupMap(groups);
  const ruleIds = new Set();

  rules.forEach((rule, index) => {
    const path = `compatibility_rules[${index}]`;
    if (!isPlainObject(rule)) {
      errors.push(`${path} must be an object`);
      return;
    }

    requirePattern(errors, `${path}.rule_id`, rule.rule_id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    if (ruleIds.has(rule.rule_id)) errors.push(`duplicate rule_id "${rule.rule_id}"`);
    ruleIds.add(rule.rule_id);
    requireInteger(errors, `${path}.priority`, rule.priority);
    requireEnum(errors, `${path}.status`, rule.status, CONFIG_STATUSES);
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

    requireGroupOption(errors, conditionPath, condition.group_key, condition.option_key, groupMap);
    requireEnum(errors, `${conditionPath}.operator`, condition.operator, CONDITION_OPERATORS);
  });
}

function validateRuleTarget(errors, rule, path, groupMap) {
  if (!isPlainObject(rule.target)) {
    errors.push(`${path}.target must be an object`);
    return;
  }

  const targetGroup = groupMap.get(rule.target.group_key);
  if (!targetGroup) {
    errors.push(`${path}.target.group_key references an unknown group`);
    return;
  }

  if (rule.target.option_key != null) {
    requireGroupOption(errors, `${path}.target`, rule.target.group_key, rule.target.option_key, groupMap);
  }

  for (const key of ["allowed_option_keys", "denied_option_keys", "required_option_keys"]) {
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

  if (rule.fallback_option_key != null && !targetGroup.optionKeys.has(rule.fallback_option_key)) {
    errors.push(`${path}.fallback_option_key references an unknown option`);
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

    requirePattern(errors, `${path}.preset_id`, preset.preset_id, KEY_REGEX);
    if (presetIds.has(preset.preset_id)) errors.push(`duplicate preset_id "${preset.preset_id}"`);
    presetIds.add(preset.preset_id);
    requireNonEmptyString(errors, `${path}.label`, preset.label);
    requireBoolean(errors, `${path}.active`, preset.active);
    requireInteger(errors, `${path}.display_order`, preset.display_order);
    requireBoolean(errors, `${path}.validate_compatibility`, preset.validate_compatibility);

    if (!isPlainObject(preset.selections)) {
      errors.push(`${path}.selections must be an object`);
      return;
    }

    Object.entries(preset.selections).forEach(([groupKey, optionKey]) => {
      requireGroupOption(errors, `${path}.selections.${groupKey}`, groupKey, optionKey, groupMap);
      const group = groupMap.get(groupKey);
      if (group && !group.activeOptionKeys.has(optionKey)) {
        errors.push(`${path}.selections.${groupKey} references an inactive option`);
      }
    });

    if (preset.image_ref?.media_gid != null) {
      requirePattern(errors, `${path}.image_ref.media_gid`, preset.image_ref.media_gid, MEDIA_IMAGE_GID_REGEX);
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
}

function validateRevision(errors, revision) {
  if (!isPlainObject(revision)) {
    errors.push("revision must be an object");
    return;
  }

  requireInteger(errors, "revision.draft_revision", revision.draft_revision, { min: 1 });
  requireInteger(errors, "revision.published_revision", revision.published_revision, { min: 1 });
}

function buildGroupMap(groups) {
  const map = new Map();
  if (!Array.isArray(groups)) return map;

  groups.forEach((group) => {
    if (!isPlainObject(group) || !Array.isArray(group.options)) return;
    map.set(group.group_key, {
      optionKeys: new Set(group.options.map((option) => option.option_key)),
      activeOptionKeys: new Set(
        group.options
          .filter((option) => option.active)
          .map((option) => option.option_key),
      ),
    });
  });

  return map;
}

function requireGroupOption(errors, path, groupKey, optionKey, groupMap) {
  const group = groupMap.get(groupKey);
  if (!group) {
    errors.push(`${path}.group_key references unknown group "${groupKey}"`);
    return;
  }
  if (!group.optionKeys.has(optionKey)) {
    errors.push(`${path}.option_key references unknown option "${optionKey}"`);
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

function requireIsoDate(errors, path, value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push(`${path} must be an ISO-compatible date string`);
  }
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
