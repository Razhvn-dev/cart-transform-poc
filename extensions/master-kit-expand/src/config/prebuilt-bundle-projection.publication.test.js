import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { publishPrebuiltBundleExpandProjection } from "./prebuilt-bundle-projection.publication.js";

const DEFINITION_ID = masterKitConfigV1.configuration_id;
const REVISION_ID = "77770000-0000-4000-8000-000000000001";
const PUBLICATION_ID = "77770000-0000-4000-8000-000000000002";

function fixture() {
  const snapshot = compileRuntimeSnapshot(masterKitConfigV1);
  const definition = {
    schema_version: "bundle_definition.v1",
    bundle_definition_id: DEFINITION_ID,
    slug: masterKitConfigV1.slug,
    parent_binding: {
      product_gid: snapshot.parent.product_gid,
      variant_gid: snapshot.parent.variant_gid,
    },
    active_revision_id: REVISION_ID,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
  };
  const revision = {
    schema_version: "bundle_revision.v1",
    revision_id: REVISION_ID,
    bundle_definition_id: DEFINITION_ID,
    revision_number: 1,
    status: "published",
    configuration: masterKitConfigV1,
    runtime_snapshot_ref: {
      schema_version: snapshot.snapshot_schema,
      checksum_algorithm: snapshot.checksum_algorithm,
      checksum: snapshot.checksum,
      configuration_version: snapshot.configuration_version,
    },
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
    created_by: "test",
  };
  return {
    publication_id: PUBLICATION_ID,
    definition,
    revision,
    snapshot,
    fixed_selections: Object.fromEntries(snapshot.groups.map((group) => [group.key, group.default_option])),
    pilot_scope: {
      schema_version: "prebuilt_bundle_pilot_scope.v1",
      pilot_scope_id: "77770000-0000-4000-8000-000000000003",
      store_domain: "huang-mvqquz1p.myshopify.com",
      approved_product_series_keys: ["master-kit"],
      approved_parent_variant_gids: [snapshot.parent.variant_gid],
    },
    at: "2026-07-20T00:00:00Z",
  };
}

function persistence({ previous = null, failAudit = false } = {}) {
  let projection = previous;
  let record = null;
  const events = [];
  return {
    events,
    get projection() { return projection; },
    get record() { return record; },
    async readPublicationById() { return record; },
    async readPrebuiltExpandProjection() { events.push("read"); return projection; },
    async writePrebuiltExpandProjection(input) {
      events.push("write");
      expect(projection?.checksum ?? null).toBe(input.expected_previous_projection_checksum);
      projection = structuredClone(input.projection);
      return projection;
    },
    async restorePreviousPrebuiltExpandProjection(input) {
      events.push("restore");
      expect(projection.checksum).toBe(input.target_projection_checksum);
      projection = structuredClone(input.previous_projection);
      return projection;
    },
    async writePublicationRecord(input) {
      events.push("audit");
      if (failAudit) throw new Error("audit unavailable");
      record = structuredClone(input.record);
      return record;
    },
  };
}

describe("pre-built projection publication orchestration", () => {
  it("writes, verifies, and audits one projection in order", async () => {
    const store = persistence();
    const result = await publishPrebuiltBundleExpandProjection(fixture(), { persistence: store });

    expect(result).toMatchObject({ success: true, compensation_required: false });
    expect(store.events).toEqual(["read", "write", "read", "audit"]);
    expect(store.projection.components).toHaveLength(3);
    expect(store.record.projection_checksum).toBe(result.projection_checksum);
  });

  it("returns an idempotent success without rewriting the carrier", async () => {
    const store = persistence();
    const first = await publishPrebuiltBundleExpandProjection(fixture(), { persistence: store });
    store.events.length = 0;
    const second = await publishPrebuiltBundleExpandProjection(fixture(), { persistence: store });

    expect(second).toMatchObject({ projection_checksum: first.projection_checksum, idempotent_retry: true });
    expect(store.events).toEqual([]);
  });

  it("restores a previous projection when audit persistence fails", async () => {
    const originalStore = persistence();
    await publishPrebuiltBundleExpandProjection(fixture(), { persistence: originalStore });
    const previous = structuredClone(originalStore.projection);
    const store = persistence({ previous, failAudit: true });

    await expect(publishPrebuiltBundleExpandProjection({
      ...fixture(),
      publication_id: "77770000-0000-4000-8000-000000000004",
    }, { persistence: store })).rejects.toMatchObject({
      details: { compensation: { attempted: true, success: true } },
    });
    expect(store.events).toEqual(["read", "write", "read", "audit", "restore"]);
    expect(store.projection).toEqual(previous);
  });

  it("reports manual reconciliation when the first write cannot be deleted", async () => {
    const store = persistence({ failAudit: true });
    await expect(publishPrebuiltBundleExpandProjection(fixture(), { persistence: store }))
      .rejects.toMatchObject({
        details: {
          compensation: {
            attempted: false,
            success: false,
            reason: "INITIAL_PROJECTION_DELETE_WITH_CAS_UNSUPPORTED",
          },
        },
      });
  });
});
