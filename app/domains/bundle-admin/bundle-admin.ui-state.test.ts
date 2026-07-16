import { describe, expect, it } from "vitest";
import { findLatestDraft, getEnvelopeError, parseConfigurationDocument } from "./bundle-admin.ui-state";

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
});
