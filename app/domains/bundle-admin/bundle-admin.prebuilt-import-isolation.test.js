import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

describe("pre-built import review isolation", () => {
  it("keeps the Admin review surface dry-run only", async () => {
    const [service, route, page] = await Promise.all([
      readFile(resolve(root, "app/domains/bundle-admin/bundle-admin.service.js"), "utf8"),
      readFile(resolve(root, "app/routes/app.bundle-admin.prebuilt-imports.review.ts"), "utf8"),
      readFile(resolve(root, "app/routes/app.bundle-admin.prebuilt-imports.tsx"), "utf8"),
    ]);

    expect(service).toContain("createPrebuiltBundleImportPlan");
    expect(service).not.toContain("executeConfirmedPrebuiltBundleImport");
    expect(route).toContain("reviewPrebuiltBundleImport");
    expect(page).toContain("/app/bundle-admin/prebuilt-imports/review");
    expect(page).toContain("Source components");
    expect(page).toContain("Target BundleDefinition");
    expect(page).toContain("Fixed selections");
    expect(page).toContain("Record status");
    expect(page).toContain("RECORDS_PER_PAGE = 25");
    expect(page).toContain("filteredRecords.slice");
    expect(page).not.toContain("executeConfirmedPrebuiltBundleImport");
    expect(page).not.toContain("writeRuntimeSnapshot");
    expect(page).not.toContain("active_revision_id");
  });
});
