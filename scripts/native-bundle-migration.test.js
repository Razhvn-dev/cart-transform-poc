import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assessNativeBundleMigrationAcceptance,
  planNativeBundleMigration,
} from "./native-bundle-migration.js";

describe("native Bundle migration workflow", () => {
  it("blocks a conflicting product until its relationship owner App is identified", () => {
    const result = planNativeBundleMigration(inventory([{ product: product({ conflict: true }) }]));

    expect(result).toMatchObject({
      status: "blocked_on_owner_identification",
      writes_performed: false,
      summary: { cleanup_required: 1, blockers: 1 },
    });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "OWNER_APP_REQUIRED" }));
  });

  it("creates an owner-bound plan without producing a Shopify mutation", () => {
    const result = planNativeBundleMigration(inventory([
      { product: product({ conflict: true }), relationship_owner_app: "Legacy Bundles App" },
      { product: product({ id: "2" }) },
    ]));

    expect(result).toMatchObject({
      status: "ready_for_approved_cleanup",
      cleanup_plan_ready: true,
      writes_performed: false,
      requires_external_approval: true,
      summary: { total: 2, cleanup_required: 1, conflict_free: 1 },
    });
  });

  it("accepts only complete post-cleanup product-edit and runtime evidence", () => {
    const result = assessNativeBundleMigrationAcceptance(acceptanceEvidence());

    expect(result).toMatchObject({ status: "passed", accepted: true, writes_performed: false });
  });

  it("fails when native state remains or Compare-at price was not verified", () => {
    const result = assessNativeBundleMigrationAcceptance(acceptanceEvidence({
      after_product: product({ conflict: true }),
      product_edit: {
        image_saved: true,
        price_saved: true,
        compare_at_price_saved: false,
        reload_verified: true,
      },
    }));

    expect(result.accepted).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "NATIVE_BUNDLE_STATE_REMAINS" }),
      expect.objectContaining({ message: "product_edit.compare_at_price_saved must be true" }),
    ]));
  });

  it("runs both CLIs locally and rejects mutation flags", () => {
    const directory = mkdtempSync(join(tmpdir(), "native-bundle-migration-"));
    const inventoryPath = join(directory, "inventory.json");
    const acceptancePath = join(directory, "acceptance.json");
    writeFileSync(inventoryPath, JSON.stringify(inventory([
      { product: product({ conflict: true }), relationship_owner_app: "Legacy Bundles App" },
    ])));
    writeFileSync(acceptancePath, JSON.stringify(acceptanceEvidence()));

    const plan = spawnSync(process.execPath, ["scripts/plan-native-bundle-migration.mjs", "--input", inventoryPath], cliOptions());
    const check = spawnSync(process.execPath, ["scripts/check-native-bundle-migration-acceptance.mjs", "--input", acceptancePath], cliOptions());
    const rejected = spawnSync(process.execPath, ["scripts/plan-native-bundle-migration.mjs", "--apply", "--input", inventoryPath], cliOptions());

    expect(plan.status).toBe(0);
    expect(JSON.parse(plan.stdout)).toMatchObject({ status: "ready_for_approved_cleanup", writes_performed: false });
    expect(check.status).toBe(0);
    expect(JSON.parse(check.stdout)).toMatchObject({ accepted: true, writes_performed: false });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("cannot mutate Shopify");
  });
});

function inventory(products) {
  return {
    schema_version: "native_bundle_migration_inventory.v1",
    target: { store_domain: "development-store.myshopify.com" },
    products,
  };
}

function acceptanceEvidence(overrides = {}) {
  return {
    schema_version: "native_bundle_migration_acceptance.v1",
    before_product: product({ conflict: true }),
    after_product: product(),
    cleanup: { owner_app: "Legacy Bundles App", performed_by_relationship_owner_app: true },
    product_edit: {
      image_saved: true,
      price_saved: true,
      compare_at_price_saved: true,
      reload_verified: true,
    },
    combined_listing: { edit_saved: true },
    runtime_regression: {
      cart_single_parent_line: true,
      checkout_components_expanded: true,
      pilot_acceptance_passed: true,
    },
    ...overrides,
  };
}

function product({ id = "1", conflict = false } = {}) {
  return {
    id: `gid://shopify/Product/${id}`,
    title: `Product ${id}`,
    combinedListingRole: "PARENT",
    variants: {
      nodes: [{
        id: `gid://shopify/ProductVariant/${id}`,
        title: "Default",
        sku: `SKU-${id}`,
        requiresComponents: conflict,
        productVariantComponents: {
          nodes: conflict ? [{ id: `gid://shopify/ProductVariantComponent/${id}`, quantity: 1 }] : [],
        },
      }],
    },
  };
}

function cliOptions() {
  return { cwd: process.cwd(), encoding: "utf8" };
}
