import { describe, expect, it } from "vitest";
import {
  findLatestDraft,
  getDraftEditorHydrationKey,
  getEnvelopeError,
  isPersistedDraftConfiguration,
  getStructuredConfigurationEntities,
  parseConfigurationDocument,
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
    expect(updateStructuredConfiguration(optionResult.value!, "compatibility_rules", { entityKey: "street-efi" }, { priority: 20 }).value)
      .toMatchObject({ compatibility_rules: [{ priority: 20, future_rule_field: "keep" }] });
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
});
