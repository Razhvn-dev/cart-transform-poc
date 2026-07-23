import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

describe("pre-built import recovery assessment isolation", () => {
  it("exposes only the authenticated read-only recovery assessment handler", async () => {
    const route = await readFile(
      resolve(root, "app/routes/app.bundle-admin.prebuilt-imports.recovery-assessment.ts"),
      "utf8",
    );

    expect(route).toContain("bundleAdminRoutes.assessPrebuiltBundleImportRecovery");
    expect(route).not.toContain("executePrebuiltBundleImport");
    expect(route).not.toContain("publishDraftRevision");
    expect(route).not.toContain("rollbackPublishedRevision");
  });

  it("keeps the Admin recovery UI bounded to the current 25-record page and diagnostic-only", async () => {
    const page = await readFile(
      resolve(root, "app/routes/app.bundle-admin.prebuilt-imports.tsx"),
      "utf8",
    );

    expect(page).toContain("/app/bundle-admin/prebuilt-imports/recovery-assessment");
    expect(page).toContain("Assess this page (read only)");
    expect(page).toContain("source_identities: sourceIdentities");
    expect(page).toContain("pageRecords.map((record) => record.source_identity)");
    expect(page).toContain("already_completed");
    expect(page).toContain("requires_target_reconciliation");
    expect(page).toContain("retry_conflict");
    expect(page).toContain("ready_to_execute");
    expect(page).toContain("RECORDS_PER_PAGE = 25");
    expect(page).toContain("pendingReviewRequest");
    expect(page).toContain("reviewRequestWasSubmitted");
    expect(page).toContain("fetcher.data?.ok");
    expect(page).toContain("disabled={reviewLoading || pageRecords.length === 0}");
    expect(page).toContain("recoverySelection.length > 0");
    expect(page).not.toContain("/app/bundle-admin/prebuilt-imports/execute");
    expect(page).not.toContain("publishDraftRevision");
    expect(page).not.toContain("rollbackPublishedRevision");
  });
});
