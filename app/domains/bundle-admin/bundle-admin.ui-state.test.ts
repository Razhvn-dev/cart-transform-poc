import { describe, expect, it } from "vitest";
import { masterKitConfigV1 } from "../../../extensions/master-kit-expand/src/config/fixtures/master-kit-config.v1.js";
import { validateBundleConfig } from "../../../extensions/master-kit-expand/src/config/bundle-config.validator.js";
import { compileRuntimeSnapshot } from "../../../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import {
  findLatestDraft,
  getDraftEditorHydrationKey,
  getEnvelopeError,
  getStructuredConfigurationReferences,
  isPersistedDraftConfiguration,
  getStructuredConfigurationEntities,
  parseConfigurationDocument,
  parseImportReviewDocument,
  duplicateStructuredConfigurationEntity,
  createStructuredConfigurationEntity,
  removeStructuredConfigurationEntity,
  updateStructuredConfiguration,
} from "./bundle-admin.ui-state";

describe("Bundle Admin UI state helpers", () => {
  it("rehydrates the editor when the current draft changes without changing its ID", () => {
    const original = getDraftEditorHydrationKey("2026-07-16T00:00:00Z", {
      revision_id: "revision-1",
      revision_number: 1,
      status: "draft",
      updated_at: "2026-07-16T00:00:00Z",
    });
    const saved = getDraftEditorHydrationKey("2026-07-16T00:00:00Z", {
      revision_id: "revision-1",
      revision_number: 1,
      status: "draft",
      updated_at: "2026-07-16T00:05:00Z",
    });

    expect(saved).not.toBe(original);
  });

  it("updates only the selected structured entity and preserves future fields", () => {
    const configuration = {
      component_groups: [{
        group_key: "efi",
        label: "EFI",
        future_group_field: "keep",
        options: [{ option_key: "efi-standard", label: "Standard", active: true, future_option_field: "keep" }],
      }],
      presets: [{ preset_id: "street", label: "Street", active: true, future_preset_field: "keep" }],
      compatibility_rules: [{ rule_id: "street-efi", priority: 10, status: "active", future_rule_field: "keep" }],
      future_root_field: "keep",
    };

    const groupResult = updateStructuredConfiguration(configuration, "groups", { entityKey: "efi" }, { label: "EFI system" });
    expect(groupResult).toMatchObject({ error: null });
    expect(groupResult.value).toMatchObject({
      future_root_field: "keep",
      component_groups: [{ label: "EFI system", future_group_field: "keep" }],
    });
    expect(configuration.component_groups[0].label).toBe("EFI");

    const optionResult = updateStructuredConfiguration(groupResult.value!, "options", {
      groupKey: "efi",
      entityKey: "efi-standard",
    }, { active: false });
    expect(optionResult.value).toMatchObject({ component_groups: [{ options: [{ active: false, future_option_field: "keep" }] }] });

    expect(updateStructuredConfiguration(optionResult.value!, "presets", { entityKey: "street" }, { label: "Street package" }).value)
      .toMatchObject({ presets: [{ label: "Street package", future_preset_field: "keep" }] });
    expect(updateStructuredConfiguration(optionResult.value!, "presets", { entityKey: "street" }, {
      selections: { efi: "efi-standard" },
      locked_selections: ["efi"],
    }).value).toMatchObject({ presets: [{ selections: { efi: "efi-standard" }, future_preset_field: "keep" }] });
    expect(updateStructuredConfiguration(optionResult.value!, "compatibility_rules", { entityKey: "street-efi" }, {
      priority: 20,
      allowed_option_keys: ["efi-standard"],
      target: { group_key: "efi" },
    }).value).toMatchObject({ compatibility_rules: [{ priority: 20, allowed_option_keys: ["efi-standard"], target: { group_key: "efi" }, future_rule_field: "keep" }] });
  });

  it("reports malformed sections and missing structured entities without mutating input", () => {
    const configuration = { component_groups: [{ group_key: "efi", options: [] }] };
    expect(updateStructuredConfiguration(configuration, "options", { entityKey: "x" }, { active: false }).error)
      .toContain("requires a component group");
    expect(updateStructuredConfiguration(configuration, "groups", { entityKey: "fuel" }, { label: "Fuel" }).error)
      .toContain("was not found");
    expect(updateStructuredConfiguration({ component_groups: "bad" }, "groups", { entityKey: "efi" }, { label: "EFI" }).error)
      .toContain("must be an array");
    expect(getStructuredConfigurationEntities(configuration)).toMatchObject({ groups: [{ group_key: "efi" }], presets: [], compatibilityRules: [] });
  });

  it("selects the latest draft without considering immutable revisions editable", () => {
    expect(findLatestDraft([
      { revision_id: "published", revision_number: 1, status: "published" },
      { revision_id: "draft-one", revision_number: 2, status: "draft" },
      { revision_id: "draft-two", revision_number: 3, status: "draft" },
    ])).toMatchObject({ revision_id: "draft-two" });
  });

  it("reports API failures and prevents non-object JSON from becoming a draft document", () => {
    expect(getEnvelopeError({ ok: false, error: { code: "CONFLICT", message: "stale" } }))
      .toMatchObject({ code: "CONFLICT" });
    expect(parseConfigurationDocument("[]").error).toContain("JSON object");
    expect(parseConfigurationDocument('{"slug":"aces"}')).toMatchObject({ error: null, value: { slug: "aces" } });
  });

  it("parses import review documents without accepting the wrong JSON shape", () => {
    expect(parseImportReviewDocument("[]", "Source records", "array")).toMatchObject({ error: null, value: [] });
    expect(parseImportReviewDocument("{}", "Pilot scope", "object")).toMatchObject({ error: null, value: {} });
    expect(parseImportReviewDocument("{}", "Source records", "array").error).toContain("JSON array");
    expect(parseImportReviewDocument("[]", "Pilot scope", "object").error).toContain("JSON object");
    expect(parseImportReviewDocument("[]", "Raw export", "json-container")).toMatchObject({ error: null, value: [] });
    expect(parseImportReviewDocument("{}", "Raw export", "json-container")).toMatchObject({ error: null, value: {} });
    expect(parseImportReviewDocument("null", "Raw export", "json-container").error).toContain("array or object");
    expect(parseImportReviewDocument("{", "Mappings", "array").error).toContain("invalid JSON");
  });

  it("confirms a save only when the refreshed matching draft contains the expected configuration", () => {
    const expected = { schema_version: "bundle_config.v1", internal_name: "Saved" };
    expect(isPersistedDraftConfiguration([
      { revision_id: "draft", revision_number: 1, status: "draft", configuration: { internal_name: "Saved", schema_version: "bundle_config.v1" } },
    ], "draft", expected)).toBe(true);
    expect(isPersistedDraftConfiguration([
      { revision_id: "draft", revision_number: 1, status: "draft", configuration: { schema_version: "bundle_config.v1" } },
    ], "draft", expected)).toBe(false);
    expect(isPersistedDraftConfiguration([
      { revision_id: "published", revision_number: 1, status: "published", configuration: expected },
    ], "published", expected)).toBe(false);
  });

  it("finds every supported Group and Option reference before removal", () => {
    const configuration = referenceConfiguration();

    expect(getStructuredConfigurationReferences(configuration, { section: "groups", entityKey: "efi" }))
      .toEqual(expect.arrayContaining([
        { source: "preset", sourceId: "street", field: "selections.efi" },
        { source: "preset", sourceId: "street", field: "locked_selections" },
        { source: "compatibility_rule", sourceId: "efi-rule", field: "target.group_key" },
        { source: "compatibility_rule", sourceId: "efi-rule", field: "when.0.group_key" },
      ]));
    expect(getStructuredConfigurationReferences(configuration, { section: "options", groupKey: "efi", entityKey: "standard" }))
      .toEqual(expect.arrayContaining([
        { source: "component_group", sourceId: "efi", field: "default_option_key" },
        { source: "preset", sourceId: "street", field: "selections.efi" },
        { source: "compatibility_rule", sourceId: "efi-rule", field: "target.option_key" },
        { source: "compatibility_rule", sourceId: "efi-rule", field: "when.0.option_key" },
        { source: "compatibility_rule", sourceId: "efi-rule", field: "allowed_option_keys" },
        { source: "compatibility_rule", sourceId: "efi-rule", field: "fallback_option_key" },
      ]));
  });

  it("rejects referenced removals and safely removes an unreferenced option without mutating input", () => {
    const configuration = referenceConfiguration();
    const blocked = removeStructuredConfigurationEntity(configuration, { section: "options", groupKey: "efi", entityKey: "standard" });
    expect(blocked.error).toContain("while it is referenced");
    expect(blocked.references).not.toHaveLength(0);
    expect(configuration.component_groups[0].options).toHaveLength(2);

    const removed = removeStructuredConfigurationEntity(configuration, { section: "options", groupKey: "efi", entityKey: "spare" });
    expect(removed).toMatchObject({ error: null, value: { component_groups: [{ options: [{ option_key: "standard" }] }] } });
    expect(configuration.component_groups[0].options).toHaveLength(2);
    expect(removeStructuredConfigurationEntity({ component_groups: [{ group_key: "efi", options: [{ option_key: "only" }] }] }, {
      section: "options", groupKey: "efi", entityKey: "only",
    }).error).toContain("only option");
  });

  it("duplicates only presets and rules into non-effective draft copies", () => {
    const configuration = referenceConfiguration();
    const presetCopy = duplicateStructuredConfigurationEntity(configuration, "presets", "street");
    expect(presetCopy).toMatchObject({
      error: null,
      createdEntity: { preset_id: "street_copy", active: false, display_order: 20 },
    });
    expect(presetCopy.value?.presets).toHaveLength(2);
    expect(configuration.presets).toHaveLength(1);
    expect(duplicateStructuredConfigurationEntity(presetCopy.value!, "presets", "street").createdEntity)
      .toMatchObject({ preset_id: "street_copy_2" });

    const ruleCopy = duplicateStructuredConfigurationEntity(configuration, "compatibility_rules", "efi-rule");
    expect(ruleCopy).toMatchObject({
      error: null,
      createdEntity: { rule_id: "efi-rule-copy", status: "draft", priority: 20 },
    });
    expect(duplicateStructuredConfigurationEntity(ruleCopy.value!, "compatibility_rules", "efi-rule").createdEntity)
      .toMatchObject({ rule_id: "efi-rule-copy-2" });
  });

  it("creates valid inactive preset and draft rule defaults without product writes", () => {
    const configuration = referenceConfiguration();
    const preset = createStructuredConfigurationEntity(configuration, "presets");
    expect(preset).toMatchObject({
      error: null,
      createdEntity: {
        preset_id: "new_preset",
        active: false,
        display_order: 20,
        validate_compatibility: true,
        selections: { efi: "standard" },
      },
    });
    const rule = createStructuredConfigurationEntity(configuration, "compatibility_rules");
    expect(rule).toMatchObject({
      error: null,
      createdEntity: {
        rule_id: "new-rule",
        status: "draft",
        effect: "allow",
        when: [{ group_key: "efi", option_key: "standard", operator: "selected" }],
        target: { group_key: "efi", option_key: "standard" },
      },
    });
    expect(configuration.presets).toHaveLength(1);
    expect(configuration.compatibility_rules).toHaveLength(1);
  });

  it("creates V1-valid draft entities that compile without becoming runtime authority", () => {
    const configuration = structuredClone(masterKitConfigV1) as Record<string, unknown>;
    const preset = createStructuredConfigurationEntity(configuration, "presets");
    const rule = createStructuredConfigurationEntity(preset.value!, "compatibility_rules");

    expect(preset.error).toBeNull();
    expect(rule.error).toBeNull();
    expect(validateBundleConfig(rule.value!)).toEqual([]);

    const snapshot = compileRuntimeSnapshot(rule.value!);
    expect(snapshot.presets).toHaveLength(masterKitConfigV1.presets.length);
    expect(snapshot.rules).toHaveLength(masterKitConfigV1.compatibility_rules.length);
  });

  it("refuses safe entity creation when the configuration has no active option", () => {
    const configuration = referenceConfiguration();
    configuration.component_groups[0].options[0].active = false;
    configuration.component_groups[0].options[1].active = false;
    expect(createStructuredConfigurationEntity(configuration, "presets").error)
      .toContain("active default option");
  });
});

function referenceConfiguration() {
  return {
    component_groups: [{
      group_key: "efi",
      default_option_key: "standard",
      options: [
        { option_key: "standard", label: "Standard", active: true },
        { option_key: "spare", label: "Spare", active: true, future_option_field: "keep" },
      ],
    }],
    presets: [{
      preset_id: "street",
      label: "Street",
      active: true,
      display_order: 10,
      selections: { efi: "standard" },
      locked_selections: ["efi"],
    }],
    compatibility_rules: [{
      rule_id: "efi-rule",
      priority: 10,
      status: "active",
      when: [{ group_key: "efi", option_key: "standard" }],
      target: { group_key: "efi", option_key: "standard" },
      allowed_option_keys: ["standard"],
      denied_option_keys: ["other"],
      required_option_keys: ["other"],
      fallback_option_key: "standard",
    }],
  };
}
