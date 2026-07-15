import { parseBundleConfig } from "./bundle-config.parser.js";

export function resolveBundleSelection(configInput, selectionsByCartAttribute = {}) {
  const config = parseBundleConfig(configInput);
  const groups = buildGroupIndexes(config);
  const selections = selectDefaults(config, groups);

  for (const group of config.component_groups) {
    const requestedValue = selectionsByCartAttribute[group.cart_attribute]?.trim();
    const requestedOption = findOptionByVariantOrKey(group, requestedValue);
    if (requestedOption?.active) selections.set(group.group_key, requestedOption.option_key);
  }

  applyCompatibilityRules(config, groups, selections);

  const components = config.component_groups
    .filter((group) => isGroupIncluded(config, groups, selections, group))
    .map((group, index) => {
      const option = groups.optionsByGroup.get(group.group_key).get(selections.get(group.group_key));
      return {
        sequence: index + 1,
        groupKey: group.group_key,
        slot: group.slot,
        optionKey: option.option_key,
        variantId: option.variant_gid,
        productId: option.product_gid,
        sku: option.sku,
        title: option.label,
        componentGroup: group.group_key,
        componentRole: option.metadata_role || group.role,
        componentRequired: group.required,
        priceCents: option.price_cents_snapshot,
      };
    });

  const allocatedPrices = allocateDiscountedPrices(components, config.pricing.discount.basis_points);

  return {
    configurationId: config.configuration_id,
    configurationVersion: config.configuration_version,
    parent: config.parent,
    components: components.map((component, index) => ({
      ...component,
      allocatedPriceCents: allocatedPrices[index],
      fixedPricePerUnit: centsToDecimalString(allocatedPrices[index]),
    })),
  };
}

function buildGroupIndexes(config) {
  const optionsByGroup = new Map();

  for (const group of config.component_groups) {
    optionsByGroup.set(
      group.group_key,
      new Map(group.options.map((option) => [option.option_key, option])),
    );
  }

  return { optionsByGroup };
}

function selectDefaults(config, groups) {
  const selections = new Map();

  for (const group of config.component_groups) {
    const options = groups.optionsByGroup.get(group.group_key);
    const defaultOption = options.get(group.default_option_key);
    const fallbackOption = defaultOption?.active
      ? defaultOption
      : group.options.find((option) => option.active);

    if (fallbackOption) selections.set(group.group_key, fallbackOption.option_key);
  }

  return selections;
}

function findOptionByVariantOrKey(group, requestedValue) {
  if (!requestedValue) return null;

  return group.options.find((option) =>
    option.variant_gid === requestedValue || option.option_key === requestedValue
  ) || null;
}

function applyCompatibilityRules(config, groups, selections) {
  for (const rule of config.compatibility_rules) {
    if (rule.status !== "active" || !conditionsMatch(rule, selections)) continue;

    if (rule.effect === "allow") {
      applyAllowRule(rule, groups, selections);
    }
  }
}

function conditionsMatch(rule, selections) {
  const matches = rule.when.map((condition) =>
    condition.operator === "selected" &&
    selections.get(condition.group_key) === condition.option_key
  );

  return rule.match === "any" ? matches.some(Boolean) : matches.every(Boolean);
}

function applyAllowRule(rule, groups, selections) {
  const targetGroupKey = rule.target.group_key;
  const selectedOptionKey = selections.get(targetGroupKey);
  const allowed = new Set(rule.allowed_option_keys || []);

  if (allowed.has(selectedOptionKey)) return;

  const targetOptions = groups.optionsByGroup.get(targetGroupKey);
  const fallbackOption = targetOptions.get(rule.fallback_option_key);
  if (fallbackOption?.active) {
    selections.set(targetGroupKey, fallbackOption.option_key);
    return;
  }

  const firstAllowedOption = [...allowed]
    .map((optionKey) => targetOptions.get(optionKey))
    .find((option) => option?.active);

  if (firstAllowedOption) selections.set(targetGroupKey, firstAllowedOption.option_key);
}

function isGroupIncluded(config, groups, selections, group) {
  if (group.required) return true;

  for (const rule of config.compatibility_rules) {
    if (
      rule.status === "active" &&
      rule.effect === "visibility" &&
      rule.target.group_key === group.group_key &&
      conditionsMatch(rule, selections)
    ) {
      return rule.visible !== false && rule.component_included !== false;
    }
  }

  const option = groups.optionsByGroup.get(group.group_key).get(selections.get(group.group_key));
  return Boolean(option?.active);
}

function allocateDiscountedPrices(components, basisPoints) {
  const subtotalCents = components.reduce(
    (total, component) => total + component.priceCents,
    0,
  );
  const finalTotalCents =
    subtotalCents - calculatePercentageDiscountCents(subtotalCents, basisPoints);
  const allocatedPrices = components.map((component) =>
    component.priceCents - calculatePercentageDiscountCents(component.priceCents, basisPoints),
  );
  const allocatedTotalCents = allocatedPrices.reduce(
    (total, priceCents) => total + priceCents,
    0,
  );
  const deltaCents = finalTotalCents - allocatedTotalCents;

  if (allocatedPrices.length > 0) {
    allocatedPrices[allocatedPrices.length - 1] += deltaCents;
  }

  return allocatedPrices;
}

function calculatePercentageDiscountCents(priceCents, basisPoints) {
  return Math.floor((priceCents * basisPoints + 5000) / 10000);
}

function centsToDecimalString(cents) {
  const dollars = Math.floor(cents / 100);
  const centsRemainder = String(cents % 100).padStart(2, "0");

  return `${dollars}.${centsRemainder}`;
}
