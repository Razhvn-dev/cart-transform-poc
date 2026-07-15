import { BUNDLE_RUNTIME_SCHEMA_VERSION } from "./bundle-config.schema.js";
import { parseBundleConfig } from "./bundle-config.parser.js";
import { attachRuntimeSnapshotChecksum } from "./bundle-runtime.checksum.js";
import { assertValidRuntimeSnapshot } from "./bundle-runtime.validator.js";

export function compileRuntimeSnapshot(configInput) {
  const config = parseBundleConfig(configInput);

  const snapshot = attachRuntimeSnapshotChecksum({
    snapshot_schema: BUNDLE_RUNTIME_SCHEMA_VERSION,
    configuration_id: config.configuration_id,
    configuration_version: config.configuration_version,
    slug: config.slug,
    parent: {
      product_gid: config.parent.product_gid,
      variant_gid: config.parent.variant_gid,
      sku: config.parent.sku,
      title: config.parent.title,
    },
    selection: {
      cart_quantity: config.selection.cart_quantity,
      cart_parent_line_mode: config.selection.cart_parent_line_mode,
      checkout_line_mode: config.selection.checkout_line_mode,
    },
    groups: config.component_groups.map(compileGroup),
    rules: config.compatibility_rules
      .filter((rule) => rule.status === "active")
      .map(compileRule),
    presets: config.presets
      .filter((preset) => preset.active)
      .map(compilePreset),
    pricing: {
      base_price_cents: config.pricing.base_price_cents,
      discount: {
        type: config.pricing.discount.type,
        basis_points: config.pricing.discount.basis_points,
        allocation: config.pricing.discount.allocation,
      },
      currency: config.pricing.currency,
      rounding: config.pricing.rounding,
    },
    metadata: {
      bundle_contract_version: config.metadata.bundle_contract_version,
      emit_component_group: config.metadata.emit_component_group,
      emit_component_role: config.metadata.emit_component_role,
      emit_component_sequence: config.metadata.emit_component_sequence,
      future_fields: [...config.metadata.future_fields],
    },
  });

  assertValidRuntimeSnapshot(snapshot);
  return snapshot;
}

function compileGroup(group) {
  return {
    key: group.group_key,
    role: group.role,
    order: group.display_order,
    required: group.required,
    cart_attribute: group.cart_attribute,
    default_option: group.default_option_key,
    options: group.options
      .filter((option) => option.active)
      .map((option) => ({
        key: option.option_key,
        product_gid: option.product_gid,
        variant_gid: option.variant_gid,
        sku: option.sku,
        label: option.label,
        price_cents: option.price_cents_snapshot,
        media_gid: option.media_gid,
        order: option.sort_order,
        metadata_role: option.metadata_role || group.role,
      })),
  };
}

function compileRule(rule) {
  return {
    id: rule.rule_id,
    order: rule.priority,
    effect: rule.effect,
    match: rule.match,
    when: rule.when.map((condition) => ({
      group: condition.group_key,
      operator: condition.operator,
      option: condition.option_key,
    })),
    target: {
      group: rule.target.group_key,
      ...(rule.target.option_key ? { option: rule.target.option_key } : {}),
    },
    ...(rule.allowed_option_keys ? { allowed_options: [...rule.allowed_option_keys] } : {}),
    ...(rule.denied_option_keys ? { denied_options: [...rule.denied_option_keys] } : {}),
    ...(rule.required_option_keys ? { required_options: [...rule.required_option_keys] } : {}),
    ...(rule.fallback_option_key ? { fallback_option: rule.fallback_option_key } : {}),
    ...(rule.effect === "visibility"
      ? {
          visible: rule.visible,
          component_included: rule.component_included,
        }
      : {}),
  };
}

function compilePreset(preset) {
  return {
    id: preset.preset_id,
    label: preset.label,
    order: preset.display_order,
    selections: { ...preset.selections },
    ...(preset.image_ref?.media_gid ? { media_gid: preset.image_ref.media_gid } : {}),
  };
}
