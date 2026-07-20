import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { importFixture } from "./prebuilt-bundle-import.plan.test-fixture.js";
import { createPrebuiltBundleImportPlan } from "./prebuilt-bundle-import.plan.js";
import { assessPrebuiltBundleRuntimeReadiness } from "./prebuilt-bundle-runtime.readiness.js";

const REVISION_ID = "77770000-0000-4000-8000-000000000040";
const AT = "2026-07-17T00:00:00Z";

function readinessInput() {
  const packageInput = importFixture();
  const plan = createPrebuiltBundleImportPlan(packageInput);
  const configuration = structuredClone(packageInput.mappings[0].configuration);
  configuration.status = "active";
  configuration.revision = { draft_revision: 1, published_revision: 1 };
  const snapshot = compileRuntimeSnapshot(configuration);
  const definition = {
    schema_version: "bundle_definition.v1",
    bundle_definition_id: configuration.configuration_id,
    slug: configuration.slug,
    parent_binding: { product_gid: snapshot.parent.product_gid, variant_gid: snapshot.parent.variant_gid },
    active_revision_id: REVISION_ID,
    created_at: AT,
    updated_at: AT,
  };
  const revision = {
    schema_version: "bundle_revision.v1",
    revision_id: REVISION_ID,
    bundle_definition_id: configuration.configuration_id,
    revision_number: 1,
    status: "published",
    configuration,
    runtime_snapshot_ref: {
      schema_version: snapshot.snapshot_schema,
      checksum_algorithm: "fnv1a-32",
      checksum: snapshot.checksum,
      configuration_version: 1,
    },
    created_at: AT,
    updated_at: AT,
    created_by: "test",
  };
  return {
    import_plan: plan,
    pilot_scope: packageInput.pilot_scope,
    definitions: [definition],
    revisions: [revision],
    snapshots_by_definition_id: { [definition.bundle_definition_id]: snapshot },
  };
}

describe("pre-built Bundle runtime readiness", () => {
  it("proves the reviewed import through a published runtime mapping without publishing", () => {
    const result = assessPrebuiltBundleRuntimeReadiness(readinessInput());
    expect(result).toMatchObject({
      status: "ready",
      summary: { assignments_ready: 1, mappings_ready: 1, unavailable: 0 },
      catalog: { entries: [expect.objectContaining({ status: "published" })] },
      cart_metadata: {
        status: "local_contract_only",
        source: "prebuilt-bundle-product-form",
      },
      function_integration: {
        status: "blocked",
        reason: "PREBUILT_CART_METADATA_NOT_VERIFIED",
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("does not report ready when a reviewed record cannot match the published Snapshot", () => {
    const input = readinessInput();
    input.revisions[0].runtime_snapshot_ref.checksum = "deadbeef";
    const result = assessPrebuiltBundleRuntimeReadiness(input);
    expect(result).toMatchObject({
      status: "not_ready",
      summary: { assignments_ready: 1, mappings_ready: 0, unavailable: 1 },
      catalog: { unavailable: [expect.objectContaining({ reason: "SNAPSHOT_CHECKSUM_MISMATCH" })] },
      function_integration: { status: "blocked" },
    });
  });

  it("never treats a locally ready mapping catalog or local cart contract as Function integration authorization", () => {
    const result = assessPrebuiltBundleRuntimeReadiness(readinessInput());

    expect(result.status).toBe("ready");
    expect(result.cart_metadata.verification_required).toContain(
      "development_store_theme_block_cart_verification",
    );
    expect(result.function_integration.required_before_integration).toContain(
      "cart_line_bundle_metadata_v1_observation",
    );
  });
});
