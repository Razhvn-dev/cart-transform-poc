import { assertValidRuntimeSnapshot } from "./bundle-runtime.validator.js";

export function resolveRuntimeBundleSelection(snapshot, selectionsByCartAttribute = {}) {
  assertValidRuntimeSnapshot(snapshot);
  return resolveValidatedRuntimeBundleSelection(snapshot, selectionsByCartAttribute);
}

export function resolveValidatedRuntimeBundleSelection(
  snapshot,
  selectionsByCartAttribute = {},
) {

  const groups = buildGroupIndexes(snapshot);
  const selections = selectDefaults(snapshot, groups);

  for (const group of snapshot.groups) {
    const requestedValue = selectionsByCartAttribute[group.cart_attribute]?.trim();
    const requestedOption = findOptionByVariantOrKey(group, requestedValue);
    if (requestedOption) selections.set(group.key, requestedOption.key);
  }

  applyCompatibilityRules(snapshot, groups, selections);

  const components = snapshot.groups
    .filter((group) => isGroupIncluded(snapshot, groups, selections, group))
    .map((group, index) => {
      const option = groups.optionsByGroup.get(group.key).get(selections.get(group.key));
      return {
        sequence: index + 1,
        groupKey: group.key,
        optionKey: option.key,
        variantId: option.variant_gid,
        productId: option.product_gid,
        sku: option.sku,
        title: option.label,
        componentGroup: group.key,
        componentRole: option.metadata_role || group.role,
        componentRequired: group.required,
        priceCents: option.price_cents,
      };
    });

  const allocatedPrices = allocateDiscountedPrices(
    components,
    snapshot.pricing.discount.basis_points,
  );

  return {
    configurationId: snapshot.configuration_id,
    configurationVersion: snapshot.configuration_version,
    parent: snapshot.parent,
    components: components.map((component, index) => ({
      ...component,
      allocatedPriceCents: allocatedPrices[index],
      fixedPricePerUnit: centsToDecimalString(allocatedPrices[index]),
    })),
  };
}

function buildGroupIndexes(snapshot) {
  const optionsByGroup = new Map();

  for (const group of snapshot.groups) {
    optionsByGroup.set(
      group.key,
      new Map(group.options.map((option) => [option.key, option])),
    );
  }

  return { optionsByGroup };
}

function selectDefaults(snapshot, groups) {
  const selections = new Map();

  for (const group of snapshot.groups) {
    const options = groups.optionsByGroup.get(group.key);
    const defaultOption = options.get(group.default_option);
    const fallbackOption = defaultOption || group.options[0];
    if (fallbackOption) selections.set(group.key, fallbackOption.key);
  }

  return selections;
}

function findOptionByVariantOrKey(group, requestedValue) {
  if (!requestedValue) return null;

  return group.options.find((option) =>
    option.variant_gid === requestedValue || option.key === requestedValue
  ) || null;
}

function applyCompatibilityRules(snapshot, groups, selections) {
  for (const rule of snapshot.rules) {
    if (!conditionsMatch(rule, selections)) continue;

    if (rule.effect === "allow") {
      applyAllowRule(rule, groups, selections);
    }
  }
}

function conditionsMatch(rule, selections) {
  const matches = rule.when.map((condition) =>
    condition.operator === "selected" &&
    selections.get(condition.group) === condition.option
  );

  return rule.match === "any" ? matches.some(Boolean) : matches.every(Boolean);
}

function applyAllowRule(rule, groups, selections) {
  const targetGroupKey = rule.target.group;
  const selectedOptionKey = selections.get(targetGroupKey);
  const allowed = new Set(rule.allowed_options || []);

  if (allowed.has(selectedOptionKey)) return;

  const targetOptions = groups.optionsByGroup.get(targetGroupKey);
  const fallbackOption = targetOptions.get(rule.fallback_option);
  if (fallbackOption) {
    selections.set(targetGroupKey, fallbackOption.key);
    return;
  }

  const firstAllowedOption = [...allowed]
    .map((optionKey) => targetOptions.get(optionKey))
    .find(Boolean);

  if (firstAllowedOption) selections.set(targetGroupKey, firstAllowedOption.key);
}

function isGroupIncluded(snapshot, groups, selections, group) {
  if (group.required) return true;

  for (const rule of snapshot.rules) {
    if (
      rule.effect === "visibility" &&
      rule.target.group === group.key &&
      conditionsMatch(rule, selections)
    ) {
      return rule.visible !== false && rule.component_included !== false;
    }
  }

  const option = groups.optionsByGroup.get(group.key).get(selections.get(group.key));
  return Boolean(option);
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
