import { assertValidBundleConfig } from "./bundle-config.validator.js";

export function parseBundleConfig(config) {
  const normalized = normalizeBundleConfig(config);
  assertValidBundleConfig(normalized);
  return normalized;
}

export function normalizeBundleConfig(config) {
  const normalized = structuredClone(config);

  normalized.component_groups = [...normalized.component_groups]
    .map((group) => ({
      ...group,
      options: [...group.options].sort(compareByNumberThenKey("sort_order", "option_key")),
    }))
    .sort(compareByNumberThenKey("display_order", "group_key"));

  normalized.compatibility_rules = [...normalized.compatibility_rules]
    .sort(compareByNumberThenKey("priority", "rule_id"));

  normalized.presets = [...normalized.presets]
    .sort(compareByNumberThenKey("display_order", "preset_id"));

  return Object.freeze(normalized);
}

function compareByNumberThenKey(numberField, keyField) {
  return (left, right) =>
    (left[numberField] - right[numberField]) ||
    String(left[keyField]).localeCompare(String(right[keyField]));
}
