import { describe, expect, it } from "vitest";
import {
  findLatestDraft,
  getEnvelopeError,
  isPersistedDraftConfiguration,
  parseConfigurationDocument,
} from "./bundle-admin.ui-state";

describe("Bundle Admin UI state helpers", () => {
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
