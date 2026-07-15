import { describe, expect, it } from "vitest";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import {
  BundleConfigValidationError,
  assertValidBundleConfig,
  validateBundleConfig,
} from "./bundle-config.validator.js";

function cloneConfig(overrides = {}) {
  return {
    ...structuredClone(masterKitConfigV1),
    ...overrides,
  };
}

describe("bundle config validator", () => {
  it("accepts the Master Kit Schema V1 fixture", () => {
    expect(validateBundleConfig(masterKitConfigV1)).toEqual([]);
    expect(() => assertValidBundleConfig(masterKitConfigV1)).not.toThrow();
  });

  it("requires a stable UUID configuration_id and slug", () => {
    const errors = validateBundleConfig(cloneConfig({
      configuration_id: "aces-master-kit",
      slug: "ACES Master Kit",
    }));

    expect(errors).toEqual(expect.arrayContaining([
      "configuration_id has invalid format",
      "slug has invalid format",
    ]));
  });

  it("rejects duplicate group keys", () => {
    const config = cloneConfig();
    config.component_groups[1].group_key = config.component_groups[0].group_key;

    expect(validateBundleConfig(config)).toContain('duplicate group_key "efi_system"');
  });

  it("rejects duplicate option keys in a group", () => {
    const config = cloneConfig();
    config.component_groups[0].options[1].option_key =
      config.component_groups[0].options[0].option_key;

    expect(validateBundleConfig(config)).toContain(
      'duplicate option_key "efi_killshot_fusion_lite" in group "efi_system"',
    );
  });

  it("rejects required groups without active options", () => {
    const config = cloneConfig();
    config.component_groups[0].options.forEach((option) => {
      option.active = false;
    });

    expect(validateBundleConfig(config)).toEqual(expect.arrayContaining([
      "component_groups[0].default_option_key must reference an active option",
      "component_groups[0] is required but has no active options",
    ]));
  });

  it("rejects defaults that do not belong to their group", () => {
    const config = cloneConfig();
    config.component_groups[1].default_option_key = "efi_killshot_fusion_lite";

    expect(validateBundleConfig(config)).toContain(
      "component_groups[1].default_option_key must reference an option in the same group",
    );
  });

  it("rejects compatibility rules that reference missing options", () => {
    const config = cloneConfig();
    config.compatibility_rules[0].allowed_option_keys = ["missing_fuel"];

    expect(validateBundleConfig(config)).toContain(
      'compatibility_rules[0].allowed_option_keys references unknown option "missing_fuel"',
    );
  });

  it("rejects presets that reference invalid selections", () => {
    const config = cloneConfig();
    config.presets[0].selections.fuel_system = "missing_fuel";

    expect(validateBundleConfig(config)).toContain(
      'presets[0].selections.fuel_system.option_key references unknown option "missing_fuel"',
    );
  });

  it("rejects incomplete pricing rules", () => {
    const config = cloneConfig();
    config.pricing.discount.basis_points = 10001;

    expect(validateBundleConfig(config)).toContain(
      "pricing.discount.basis_points must be <= 10000",
    );
  });

  it("throws a typed error when assert validation fails", () => {
    const config = cloneConfig({ schema_version: "wrong" });

    expect(() => assertValidBundleConfig(config))
      .toThrow(BundleConfigValidationError);
  });
});
