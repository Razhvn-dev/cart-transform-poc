import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { derivePrebuiltBundleRuntimeMapping } from "./prebuilt-bundle-runtime.mapping.js";

const DEFINITION_ID = "77770000-0000-4000-8000-000000000010";
const REVISION_ID = "77770000-0000-4000-8000-000000000011";
const AT = "2026-07-17T00:00:00Z";

function fixture({ pilotScope, revisionStatus = "published", activeRevisionId = REVISION_ID } = {}) {
  const configuration = structuredClone(masterKitConfigV1);
  configuration.configuration_id = DEFINITION_ID;
  configuration.configuration_version = 1;
  configuration.status = "active";
  configuration.revision = { draft_revision: 1, published_revision: 1 };
  const snapshot = compileRuntimeSnapshot(configuration);
  const definition = {
    schema_version: "bundle_definition.v1",
    bundle_definition_id: DEFINITION_ID,
    slug: "prebuilt-standard-build",
    parent_binding: { ...snapshot.parent },
    active_revision_id: activeRevisionId,
    created_at: AT,
    updated_at: AT,
  };
  const revision = {
    schema_version: "bundle_revision.v1",
    revision_id: REVISION_ID,
    bundle_definition_id: DEFINITION_ID,
    revision_number: 1,
    status: revisionStatus,
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
    definition,
    revision,
    snapshot,
    fixed_selections: Object.fromEntries(snapshot.groups.map((group) => [group.key, group.default_option])),
    pilot_scope: pilotScope ?? {
      schema_version: "prebuilt_bundle_pilot_scope.v1",
      pilot_scope_id: "77770000-0000-4000-8000-000000000013",
      store_domain: "huang-mvqquz1p.myshopify.com",
      approved_product_series_keys: ["master-kit"],
      approved_parent_variant_gids: [snapshot.parent.variant_gid],
    },
  };
}

describe("pre-built Bundle runtime mapping derivation", () => {
  it("derives a ready server-owned mapping only from the active published revision", () => {
    const input = fixture();
    const result = derivePrebuiltBundleRuntimeMapping(input);

    expect(result).toMatchObject({
      status: "ready",
      mapping: {
        parent_variant_gid: input.snapshot.parent.variant_gid,
        bundle_definition_id: DEFINITION_ID,
        published_revision_id: REVISION_ID,
        status: "published",
        pilot_scope_approved: true,
        snapshot_checksum: input.snapshot.checksum,
      },
    });
    expect(result.resolved_candidate.components).toHaveLength(3);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ["an out-of-scope Variant", { pilotScope: { schema_version: "prebuilt_bundle_pilot_scope.v1", pilot_scope_id: "77770000-0000-4000-8000-000000000014", store_domain: "huang-mvqquz1p.myshopify.com", approved_product_series_keys: ["master-kit"], approved_parent_variant_gids: [] } }, "PILOT_SCOPE_NOT_APPROVED"],
    ["an invalid pilot", { pilotScope: { schema_version: "prebuilt_bundle_pilot_scope.v1", pilot_scope_id: "77770000-0000-4000-8000-000000000015", store_domain: "huang-mvqquz1p.myshopify.com", approved_product_series_keys: [], approved_parent_variant_gids: [] } }, "PILOT_SCOPE_NOT_APPROVED"],
    ["a draft revision", { revisionStatus: "draft" }, "INVALID_DOMAIN"],
    ["an inactive published revision", { activeRevisionId: "77770000-0000-4000-8000-000000000012" }, "INVALID_DOMAIN"],
  ])("fails closed for %s", (_label, options, reason) => {
    expect(derivePrebuiltBundleRuntimeMapping(fixture(options))).toMatchObject({ status: "unavailable", reason });
  });

  it("rejects a Snapshot that differs from the immutable published reference", () => {
    const input = fixture();
    input.revision.runtime_snapshot_ref.checksum = "deadbeef";
    expect(derivePrebuiltBundleRuntimeMapping(input)).toMatchObject({
      status: "unavailable",
      reason: "SNAPSHOT_CHECKSUM_MISMATCH",
    });
  });

  it("does not let an invalid fixed selection produce a mapping", () => {
    const input = fixture();
    input.fixed_selections.efi_system = "not-an-option";
    expect(derivePrebuiltBundleRuntimeMapping(input)).toMatchObject({
      status: "unavailable",
      reason: "INVALID_FIXED_SELECTIONS",
    });
  });
});
