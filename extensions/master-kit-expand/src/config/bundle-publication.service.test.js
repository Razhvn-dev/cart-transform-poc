import { describe, expect, it } from "vitest";
import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { createInMemoryPublicationDriver } from "./bundle-publication.in-memory-driver.js";
import {
  publishDraftRevision,
  rollbackPublishedRevision,
} from "./bundle-publication.service.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";

const definitionId = "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89";
const firstRevisionId = "0a9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef701";
const secondRevisionId = "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702";
const at = "2026-07-15T00:00:00Z";

function configuration(number, status) {
  const config = structuredClone(masterKitConfigV1);
  config.configuration_id = definitionId;
  config.configuration_version = number;
  config.status = status === "draft" ? "draft" : "active";
  config.revision.draft_revision = number;
  config.revision.published_revision = number;
  return config;
}

function snapshotRef(snapshot) {
  return {
    schema_version: snapshot.snapshot_schema,
    checksum_algorithm: snapshot.checksum_algorithm,
    checksum: snapshot.checksum,
    configuration_version: snapshot.configuration_version,
  };
}

function revision({ id, number, status, snapshot = null }) {
  const compiled = snapshot ?? (status === "draft" ? null : compileRuntimeSnapshot(configuration(number, status)));
  return {
    schema_version: "bundle_revision.v1",
    revision_id: id,
    bundle_definition_id: definitionId,
    revision_number: number,
    status,
    configuration: configuration(number, status),
    runtime_snapshot_ref: compiled ? snapshotRef(compiled) : null,
    created_at: at,
    updated_at: at,
    created_by: "publication-test",
  };
}

function definition(activeRevisionId) {
  return {
    schema_version: "bundle_definition.v1",
    bundle_definition_id: definitionId,
    slug: "aces-master-kit",
    parent_binding: {
      product_gid: masterKitConfigV1.parent.product_gid,
      variant_gid: masterKitConfigV1.parent.variant_gid,
    },
    active_revision_id: activeRevisionId,
    created_at: at,
    updated_at: at,
  };
}

function promotion(snapshot, revisionId) {
  return {
    evidence: {
      schema_version: "bundle_publication_promotion_evidence.v1",
      bundle_definition_id: definitionId,
      revision_id: revisionId,
      snapshot_checksum: snapshot.checksum,
      fixture_set_id: "unit-test",
      fixtures: [{
        fixture_id: "unit-test",
        hardcoded_result: { operations: [] },
        candidate_result: { operations: [] },
      }],
    },
  };
}

function publishInput({ activeRevisionId = firstRevisionId, revisionId = secondRevisionId, revisions }) {
  const draft = revisions.find((item) => item.revision_id === revisionId);
  const snapshot = compileRuntimeSnapshot(draft.configuration);
  return {
    publication_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
    definition: definition(activeRevisionId),
    revisions,
    revision_id: revisionId,
    promotion: promotion(snapshot, revisionId),
    at,
  };
}

function driverForCurrentRevision() {
  const currentSnapshot = compileRuntimeSnapshot(configuration(1, "published"));
  return createInMemoryPublicationDriver({
    snapshots: { [definitionId]: currentSnapshot },
    activeRevisionIds: { [definitionId]: firstRevisionId },
  });
}

describe("local staged bundle publication service", () => {
  it("publishes the first revision through every staged success step", async () => {
    const draft = revision({ id: firstRevisionId, number: 1, status: "draft" });
    const driver = createInMemoryPublicationDriver();
    const result = await publishDraftRevision(
      publishInput({ activeRevisionId: null, revisionId: firstRevisionId, revisions: [draft] }),
      driver.dependencies,
    );

    expect(result).toMatchObject({
      success: true,
      previous_active_revision_id: null,
      active_revision_id: firstRevisionId,
      failed_step: null,
    });
    expect(result.completed_steps).toEqual(expect.arrayContaining([
      "normalized_validated",
      "snapshot_compiled",
      "checksum_size_gates",
      "promotion_parity_gates",
      "snapshot_written",
      "readback_verified",
      "active_pointer_updated",
      "publication_recorded",
    ]));
    expect(driver.state.activeRevisionIds.get(definitionId)).toBe(firstRevisionId);
    expect(driver.state.records.get(result.publication_id).result.success).toBe(true);
    expect(driver.state.persistedDomain.definition.active_revision_id).toBe(firstRevisionId);
  });

  it("publishes a new revision and supersedes the previous active revision", async () => {
    const current = revision({ id: firstRevisionId, number: 1, status: "published" });
    const draft = revision({ id: secondRevisionId, number: 2, status: "draft" });
    const driver = driverForCurrentRevision();
    const result = await publishDraftRevision(publishInput({ revisions: [current, draft] }), driver.dependencies);

    expect(result.success).toBe(true);
    expect(result.domain.definition.active_revision_id).toBe(secondRevisionId);
    expect(result.domain.revisions.find((item) => item.revision_id === firstRevisionId).status).toBe("superseded");
    expect(driver.state.activeRevisionIds.get(definitionId)).toBe(secondRevisionId);
    expect(driver.state.persistedDomain.definition.active_revision_id).toBe(secondRevisionId);
  });

  it("awaits every persistence operation for an asynchronous adapter", async () => {
    const current = revision({ id: firstRevisionId, number: 1, status: "published" });
    const draft = revision({ id: secondRevisionId, number: 2, status: "draft" });
    const driver = driverForCurrentRevision();
    const dependencies = Object.fromEntries(Object.entries(driver.dependencies).map(([name, operation]) => [
      name,
      async (...args) => operation(...args),
    ]));

    const result = await publishDraftRevision(publishInput({ revisions: [current, draft] }), dependencies);

    expect(result.success).toBe(true);
    expect(driver.state.activeRevisionIds.get(definitionId)).toBe(secondRevisionId);
    expect(driver.state.records.get(result.publication_id).result.success).toBe(true);
  });

  it("returns the persisted result for an idempotent publication retry", async () => {
    const current = revision({ id: firstRevisionId, number: 1, status: "published" });
    const draft = revision({ id: secondRevisionId, number: 2, status: "draft" });
    const driver = driverForCurrentRevision();
    const input = publishInput({ revisions: [current, draft] });
    const first = await publishDraftRevision(input, driver.dependencies);
    const writeCount = driver.state.calls.filter((call) => call === "write_snapshot").length;
    const retry = await publishDraftRevision(input, driver.dependencies);

    expect(first.success).toBe(true);
    expect(retry.success).toBe(true);
    expect(retry.warnings).toContain("idempotent_retry");
    expect(driver.state.calls.filter((call) => call === "write_snapshot")).toHaveLength(writeCount);
  });

  it("retries a failed publication_id without replacing the active pointer", async () => {
    const current = revision({ id: firstRevisionId, number: 1, status: "published" });
    const draft = revision({ id: secondRevisionId, number: 2, status: "draft" });
    const driver = driverForCurrentRevision();
    let failOnce = true;
    const dependencies = {
      ...driver.dependencies,
      writeSnapshot(args) {
        if (failOnce) {
          failOnce = false;
          throw new Error("simulated write failure");
        }
        driver.dependencies.writeSnapshot(args);
      },
    };
    const input = publishInput({ revisions: [current, draft] });
    const failed = await publishDraftRevision(input, dependencies);
    const retry = await publishDraftRevision(input, dependencies);

    expect(failed).toMatchObject({ success: false, failed_step: "snapshot_write", active_revision_id: firstRevisionId });
    expect(failed.compensation.success).toBe(true);
    expect(retry.success).toBe(true);
    expect(driver.state.activeRevisionIds.get(definitionId)).toBe(secondRevisionId);
  });

  it("compensates a read-back mismatch by restoring the previous Snapshot", async () => {
    const current = revision({ id: firstRevisionId, number: 1, status: "published" });
    const draft = revision({ id: secondRevisionId, number: 2, status: "draft" });
    const driver = driverForCurrentRevision();
    let reads = 0;
    const dependencies = {
      ...driver.dependencies,
      readSnapshot(args) {
        reads += 1;
        const snapshot = driver.dependencies.readSnapshot(args);
        return reads === 2 ? { ...snapshot, checksum: "deadbeef" } : snapshot;
      },
    };
    const result = await publishDraftRevision(publishInput({ revisions: [current, draft] }), dependencies);

    expect(result).toMatchObject({ success: false, failed_step: "readback_verification" });
    expect(result.compensation).toMatchObject({ success: true, steps: ["snapshot_restored"] });
    expect(driver.state.activeRevisionIds.get(definitionId)).toBe(firstRevisionId);
    expect(driver.state.snapshots.get(definitionId).configuration_version).toBe(1);
  });

  it("compensates an uncertain pointer update failure", async () => {
    const current = revision({ id: firstRevisionId, number: 1, status: "published" });
    const draft = revision({ id: secondRevisionId, number: 2, status: "draft" });
    const driver = driverForCurrentRevision();
    const dependencies = {
      ...driver.dependencies,
      writeActiveRevisionId(args) {
        driver.dependencies.writeActiveRevisionId(args);
        throw new Error("simulated pointer response failure");
      },
    };
    const result = await publishDraftRevision(publishInput({ revisions: [current, draft] }), dependencies);

    expect(result).toMatchObject({ success: false, failed_step: "active_pointer_update" });
    expect(result.compensation).toMatchObject({ success: true });
    expect(driver.state.activeRevisionIds.get(definitionId)).toBe(firstRevisionId);
    expect(driver.state.snapshots.get(definitionId).configuration_version).toBe(1);
  });

  it("compensates pointer and Snapshot after an audit record failure", async () => {
    const current = revision({ id: firstRevisionId, number: 1, status: "published" });
    const draft = revision({ id: secondRevisionId, number: 2, status: "draft" });
    const driver = driverForCurrentRevision();
    const result = await publishDraftRevision(publishInput({ revisions: [current, draft] }), {
      ...driver.dependencies,
      writePublicationRecord() {
        throw new Error("simulated audit record failure");
      },
    });

    expect(result).toMatchObject({ success: false, failed_step: "audit_record" });
    expect(result.compensation).toMatchObject({ success: true });
    expect(result.compensation.steps).toEqual(expect.arrayContaining([
      "active_pointer_restored",
      "snapshot_restored",
    ]));
    expect(driver.state.activeRevisionIds.get(definitionId)).toBe(firstRevisionId);
  });

  it("compensates the external pointer and Snapshot when domain lifecycle persistence fails", async () => {
    const current = revision({ id: firstRevisionId, number: 1, status: "published" });
    const draft = revision({ id: secondRevisionId, number: 2, status: "draft" });
    const driver = driverForCurrentRevision();
    const result = await publishDraftRevision(publishInput({ revisions: [current, draft] }), {
      ...driver.dependencies,
      persistDomain() {
        throw new Error("simulated domain lifecycle write failure");
      },
    });

    expect(result).toMatchObject({ success: false, failed_step: "domain_lifecycle_write" });
    expect(result.compensation.steps).toEqual(expect.arrayContaining([
      "domain_restored",
      "active_pointer_restored",
      "snapshot_restored",
    ]));
    expect(driver.state.activeRevisionIds.get(definitionId)).toBe(firstRevisionId);
    expect(driver.state.snapshots.get(definitionId).configuration_version).toBe(1);
  });

  it("reports a compensation failure instead of silently claiming recovery", async () => {
    const current = revision({ id: firstRevisionId, number: 1, status: "published" });
    const draft = revision({ id: secondRevisionId, number: 2, status: "draft" });
    const driver = driverForCurrentRevision();
    let reads = 0;
    const result = await publishDraftRevision(publishInput({ revisions: [current, draft] }), {
      ...driver.dependencies,
      readSnapshot(args) {
        reads += 1;
        const snapshot = driver.dependencies.readSnapshot(args);
        return reads === 2 ? { ...snapshot, checksum: "deadbeef" } : snapshot;
      },
      restoreSnapshot() {
        throw new Error("simulated snapshot restore failure");
      },
    });

    expect(result).toMatchObject({ success: false, failed_step: "readback_verification" });
    expect(result.compensation.success).toBe(false);
    expect(result.warnings).toContain("compensation_failed");
  });

  it("detects external pointer drift before switching the active revision", async () => {
    const current = revision({ id: firstRevisionId, number: 1, status: "published" });
    const draft = revision({ id: secondRevisionId, number: 2, status: "draft" });
    const driver = driverForCurrentRevision();
    const result = await publishDraftRevision(publishInput({ revisions: [current, draft] }), {
      ...driver.dependencies,
      readActiveRevisionId() {
        return "3b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef704";
      },
    });

    expect(result).toMatchObject({ success: false, failed_step: "external_pointer_drift" });
    expect(result.compensation).toMatchObject({ success: true, steps: ["snapshot_restored"] });
    expect(driver.state.activeRevisionIds.get(definitionId)).toBe(firstRevisionId);
  });

  it("rejects a parity gate failure before any external write", async () => {
    const draft = revision({ id: firstRevisionId, number: 1, status: "draft" });
    const driver = createInMemoryPublicationDriver();
    const result = await publishDraftRevision(
      publishInput({ activeRevisionId: null, revisionId: firstRevisionId, revisions: [draft] }),
      {
        ...driver.dependencies,
        runPromotionGates: () => ({ ok: false, reason: "parity_mismatch", warnings: [] }),
      },
    );

    expect(result).toMatchObject({ success: false, failed_step: "promotion_parity_gates" });
    expect(driver.state.calls).not.toContain("write_snapshot");
  });

  it("rejects evidence that is not bound to the compiled Snapshot before any external write", async () => {
    const draft = revision({ id: firstRevisionId, number: 1, status: "draft" });
    const driver = createInMemoryPublicationDriver();
    const input = publishInput({ activeRevisionId: null, revisionId: firstRevisionId, revisions: [draft] });
    input.promotion.evidence.snapshot_checksum = "deadbeef";

    const result = await publishDraftRevision(input, driver.dependencies);

    expect(result).toMatchObject({ success: false, failed_step: "promotion_parity_gates" });
    expect(driver.state.calls).not.toContain("write_snapshot");
  });

  it.each([
    ["compile_snapshot", { compile: () => { throw new Error("simulated compiler failure"); } }],
    ["checksum_size_gates", { validateSnapshot: () => ["checksum does not match snapshot content"] }],
    ["checksum_size_gates", { sizeGuard: () => ({ ok: false, reason: "snapshot_size_hard_limit" }) }],
  ])("stops %s gate failures before any external write", async (failedStep, overrides) => {
    const draft = revision({ id: firstRevisionId, number: 1, status: "draft" });
    const driver = createInMemoryPublicationDriver();
    const result = await publishDraftRevision(
      publishInput({ activeRevisionId: null, revisionId: firstRevisionId, revisions: [draft] }),
      { ...driver.dependencies, ...overrides },
    );

    expect(result).toMatchObject({ success: false, failed_step: failedStep });
    expect(result.compensation.attempted).toBe(false);
    expect(driver.state.calls).not.toContain("write_snapshot");
  });

  it("rolls back to a superseded revision using its validated historical Snapshot", async () => {
    const oldSnapshot = compileRuntimeSnapshot(configuration(1, "published"));
    const currentSnapshot = compileRuntimeSnapshot(configuration(2, "published"));
    const previous = revision({ id: firstRevisionId, number: 1, status: "superseded", snapshot: oldSnapshot });
    const active = revision({ id: secondRevisionId, number: 2, status: "published", snapshot: currentSnapshot });
    const driver = createInMemoryPublicationDriver({
      snapshots: { [definitionId]: currentSnapshot },
      activeRevisionIds: { [definitionId]: secondRevisionId },
    });
    const result = await rollbackPublishedRevision({
      publication_id: "3b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef704",
      definition: definition(secondRevisionId),
      revisions: [previous, active],
      target_revision_id: firstRevisionId,
      target_snapshot: oldSnapshot,
      promotion: promotion(oldSnapshot, firstRevisionId),
      at,
    }, driver.dependencies);

    expect(result).toMatchObject({
      success: true,
      previous_active_revision_id: secondRevisionId,
      active_revision_id: firstRevisionId,
    });
    expect(result.domain.revisions.find((item) => item.revision_id === secondRevisionId).status).toBe("superseded");
    expect(driver.state.snapshots.get(definitionId).checksum).toBe(oldSnapshot.checksum);
  });
});
