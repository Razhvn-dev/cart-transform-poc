import { describe, expect, it, vi } from "vitest";
import { createBundleAdminService, toApplicationErrorDto } from "./bundle-admin.service.js";
import { createInMemoryBundleAdminRepository } from "./bundle-admin.in-memory-repository.js";
import { createInMemoryBundlePersistenceAdapter } from "../../../extensions/master-kit-expand/src/config/bundle-persistence.in-memory-adapter.js";
import { publishDraftRevision } from "../../../extensions/master-kit-expand/src/config/bundle-publication.service.js";
import { createInMemoryPublicationDriver } from "../../../extensions/master-kit-expand/src/config/bundle-publication.in-memory-driver.js";
import { compileRuntimeSnapshot } from "../../../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "../../../extensions/master-kit-expand/src/config/fixtures/master-kit-config.v1.js";

const definitionId = "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89";
const publishedRevisionId = "0a9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef701";
const draftRevisionId = "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702";
const createdAt = "2026-07-15T00:00:00Z";

function config(version = 1, status = "draft") {
  const value = structuredClone(masterKitConfigV1);
  value.configuration_id = definitionId;
  value.configuration_version = version;
  value.status = status;
  value.revision.draft_revision = version;
  value.revision.published_revision = version;
  return value;
}

function definition(activeRevisionId = null) {
  return {
    schema_version: "bundle_definition.v1",
    bundle_definition_id: definitionId,
    slug: "aces-master-kit",
    parent_binding: {
      product_gid: masterKitConfigV1.parent.product_gid,
      variant_gid: masterKitConfigV1.parent.variant_gid,
    },
    active_revision_id: activeRevisionId,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function revision({ id = publishedRevisionId, number = 1, status = "published" } = {}) {
  const configuration = config(number, status === "draft" ? "draft" : "active");
  const snapshot = status === "draft" ? null : compileRuntimeSnapshot(configuration);
  return {
    schema_version: "bundle_revision.v1",
    revision_id: id,
    bundle_definition_id: definitionId,
    revision_number: number,
    status,
    configuration,
    runtime_snapshot_ref: snapshot && {
      schema_version: snapshot.snapshot_schema,
      checksum_algorithm: snapshot.checksum_algorithm,
      checksum: snapshot.checksum,
      configuration_version: number,
    },
    created_at: createdAt,
    updated_at: createdAt,
    created_by: "admin-test",
  };
}

function service({ definitions = [], revisions = [], sizeGuard, compile } = {}) {
  const persistence = createInMemoryBundlePersistenceAdapter({ definitions, revisions });
  return {
    persistence,
    app: createBundleAdminService({
      persistence,
      repository: createInMemoryBundleAdminRepository({ persistence }),
      publicationService: publishDraftRevision,
      compile,
      sizeGuard,
      now: () => "2026-07-15T01:00:00Z",
      idFactory: (() => {
        let serial = 10;
        return () => `11111111-1111-4111-8111-${String(serial++).padStart(12, "0")}`;
      })(),
    }),
  };
}

describe("bundle admin application service", () => {
  it("returns an empty bundle list", async () => {
    await expect(service().app.listBundles()).resolves.toEqual([]);
  });

  it("creates, lists, and reads a bundle definition", async () => {
    const { app } = service();
    const created = await app.createBundleDefinition({
      bundle_definition_id: definitionId,
      slug: "aces-master-kit",
      parent_binding: definition().parent_binding,
      created_by: "admin",
    });

    expect(created.definition.bundle_definition_id).toBe(definitionId);
    await expect(app.listBundles()).resolves.toEqual([expect.objectContaining({
      bundle_definition_id: definitionId,
      active_revision_id: null,
      revision_count: 0,
    })]);
    expect((await app.getBundleDetail({ bundle_definition_id: definitionId })).definition.slug).toBe("aces-master-kit");
  });

  it("updates a definition while keeping revision data immutable and draft configuration editable", async () => {
    const draft = revision({ id: draftRevisionId, number: 2, status: "draft" });
    const { app } = service({ definitions: [definition(publishedRevisionId)], revisions: [revision(), draft] });
    const updated = await app.updateBundleDefinition({
      bundle_definition_id: definitionId,
      slug: "aces-master-kit-updated",
      parent_binding: definition().parent_binding,
      updated_by: "editor",
    });

    expect(updated.definition).toMatchObject({ slug: "aces-master-kit-updated", active_revision_id: publishedRevisionId });
    expect(updated.revisions.find((item) => item.revision_id === publishedRevisionId)).not.toHaveProperty("configuration");
    expect(updated.revisions.find((item) => item.revision_id === draftRevisionId)).toHaveProperty("configuration");
  });

  it("rejects a parent binding change after revisions exist", async () => {
    const { app } = service({ definitions: [definition(publishedRevisionId)], revisions: [revision()] });

    await expectApplicationError(
      () => app.updateBundleDefinition({
        bundle_definition_id: definitionId,
        slug: "aces-master-kit",
        parent_binding: {
          product_gid: "gid://shopify/Product/999",
          variant_gid: "gid://shopify/ProductVariant/999",
        },
        updated_by: "editor",
      }),
      "CONFLICT",
    );
  });

  it("allows correcting a parent binding before the first revision", async () => {
    const { app } = service({ definitions: [definition()] });
    const updated = await app.updateBundleDefinition({
      bundle_definition_id: definitionId,
      slug: "aces-master-kit",
      parent_binding: {
        product_gid: "gid://shopify/Product/999",
        variant_gid: "gid://shopify/ProductVariant/999",
      },
      updated_by: "editor",
    });

    expect(updated.definition.parent_binding).toEqual({
      product_gid: "gid://shopify/Product/999",
      variant_gid: "gid://shopify/ProductVariant/999",
    });
  });

  it("creates and edits a draft while preserving service-controlled fields", async () => {
    const { app } = service({ definitions: [definition()] });
    const created = await app.createDraftRevision({
      bundle_definition_id: definitionId,
      revision_id: draftRevisionId,
      configuration: config(),
      created_by: "editor",
    });
    const changed = config();
    changed.internal_name = "Edited by admin";
    changed.configuration_id = "wrong";
    changed.configuration_version = 99;
    const updated = await app.updateDraftRevision({
      revision_id: created.revision_id,
      configuration: changed,
      updated_by: "second-editor",
    });

    expect(updated.configuration.internal_name).toBe("Edited by admin");
    expect(updated.configuration.configuration_id).toBe(definitionId);
    expect(updated.configuration.configuration_version).toBe(1);
    expect(updated.status).toBe("draft");
  });

  it("clones the active published revision into the next draft", async () => {
    const { app } = service({ definitions: [definition(publishedRevisionId)], revisions: [revision()] });
    const cloned = await app.cloneActiveRevisionToDraft({
      bundle_definition_id: definitionId,
      revision_id: draftRevisionId,
      created_by: "editor",
    });

    expect(cloned).toMatchObject({ revision_number: 2, status: "draft", runtime_snapshot_ref: null });
    expect(cloned.configuration.configuration_version).toBe(2);
  });

  it("rejects updates to immutable revisions", async () => {
    const { app } = service({ definitions: [definition(publishedRevisionId)], revisions: [revision()] });
    await expectApplicationError(
      () => app.updateDraftRevision({ revision_id: publishedRevisionId, configuration: config(), updated_by: "editor" }),
      "IMMUTABLE_REVISION",
    );
  });

  it("reports invalid persisted drafts without attempting compilation", async () => {
    const invalid = revision({ id: draftRevisionId, number: 2, status: "draft" });
    invalid.configuration.component_groups = [];
    const { app } = service({ definitions: [definition()], revisions: [invalid] });
    const validation = await app.validateDraft({ revision_id: draftRevisionId });
    const preview = await app.compilePreview({ revision_id: draftRevisionId });

    expect(validation).toMatchObject({ valid: false });
    expect(validation.errors).toContain("revision.configuration.component_groups must be a non-empty array");
    expect(preview.snapshot_checksum).toBeNull();
  });

  it("prepares a valid draft without invoking the publication service or persistence writes", async () => {
    const persistence = createInMemoryBundlePersistenceAdapter({
      definitions: [definition()],
      revisions: [revision({ id: draftRevisionId, number: 1, status: "draft" })],
    });
    const publicationService = vi.fn();
    const writeRevision = vi.spyOn(persistence, "writeRevision");
    const app = createBundleAdminService({
      persistence,
      repository: createInMemoryBundleAdminRepository({ persistence }),
      publicationService,
      now: () => "2026-07-15T01:00:00Z",
      idFactory: () => draftRevisionId,
    });

    await expect(app.prepareDraftPublication({ revision_id: draftRevisionId })).resolves.toMatchObject({
      local_preflight_passed: true,
      blockers: [],
      required_before_publish: ["runtime_promotion_parity", "explicit_publish_authorization"],
    });
    expect(publicationService).not.toHaveBeenCalled();
    expect(writeRevision).not.toHaveBeenCalled();
  });

  it("returns draft validation blockers from the read-only publication preflight", async () => {
    const invalid = revision({ id: draftRevisionId, number: 2, status: "draft" });
    invalid.configuration.component_groups = [];
    const { app } = service({ definitions: [definition()], revisions: [invalid] });

    await expect(app.prepareDraftPublication({ revision_id: draftRevisionId })).resolves.toMatchObject({
      local_preflight_passed: false,
      snapshot_checksum: null,
      required_before_publish: ["runtime_promotion_parity", "explicit_publish_authorization"],
    });
  });

  it("keeps the publication command disabled unless an explicit server composition enables it", async () => {
    const draft = revision({ id: draftRevisionId, number: 2, status: "draft" });
    const { app } = service({ definitions: [definition(publishedRevisionId)], revisions: [revision(), draft] });

    await expectApplicationError(
      () => app.publishDraftRevision({
        revision_id: draftRevisionId,
        publication_id: "21111111-1111-4111-8111-000000000001",
        confirmation: `PUBLISH:${definitionId}:${draftRevisionId}`,
      }),
      "UNSUPPORTED_CAPABILITY",
    );
  });

  it("publishes only after server-side evidence and an exact draft confirmation", async () => {
    const current = revision();
    const draft = revision({ id: draftRevisionId, number: 2, status: "draft" });
    const persistence = createInMemoryBundlePersistenceAdapter({ definitions: [definition(publishedRevisionId)], revisions: [current, draft] });
    const publicationDriver = createInMemoryPublicationDriver({
      snapshots: { [definitionId]: compileRuntimeSnapshot(current.configuration) },
      activeRevisionIds: { [definitionId]: publishedRevisionId },
    });
    const app = createBundleAdminService({
      persistence,
      repository: createInMemoryBundleAdminRepository({ persistence }),
      publicationService: publishDraftRevision,
      publicationDriver: publicationDriver.dependencies,
      publicationEnabled: true,
      resolvePromotionEvidence: async ({ definition: currentDefinition, revision: currentRevision, snapshot_checksum: snapshotChecksum }) => ({
        evidence: {
          schema_version: "bundle_publication_promotion_evidence.v1",
          bundle_definition_id: currentDefinition.bundle_definition_id,
          revision_id: currentRevision.revision_id,
          snapshot_checksum: snapshotChecksum,
          fixture_set_id: "unit-test",
          fixtures: [{
            fixture_id: "unit-test",
            hardcoded_result: { operations: [] },
            candidate_result: { operations: [] },
          }],
        },
      }),
      now: () => "2026-07-15T01:00:00Z",
      idFactory: () => draftRevisionId,
    });

    await expect(app.publishDraftRevision({
      revision_id: draftRevisionId,
      publication_id: "21111111-1111-4111-8111-000000000001",
      confirmation: `PUBLISH:${definitionId}:${draftRevisionId}`,
    })).resolves.toMatchObject({ success: true, active_revision_id: draftRevisionId });
    expect(publicationDriver.state.activeRevisionIds.get(definitionId)).toBe(draftRevisionId);
  });

  it("fails before publication writes when the server-side evidence provider is unavailable", async () => {
    const current = revision();
    const draft = revision({ id: draftRevisionId, number: 2, status: "draft" });
    const persistence = createInMemoryBundlePersistenceAdapter({ definitions: [definition(publishedRevisionId)], revisions: [current, draft] });
    const publicationDriver = createInMemoryPublicationDriver({
      snapshots: { [definitionId]: compileRuntimeSnapshot(current.configuration) },
      activeRevisionIds: { [definitionId]: publishedRevisionId },
    });
    const app = createBundleAdminService({
      persistence,
      repository: createInMemoryBundleAdminRepository({ persistence }),
      publicationService: publishDraftRevision,
      publicationDriver: publicationDriver.dependencies,
      publicationEnabled: true,
      resolvePromotionEvidence: async () => { throw new Error("evidence file is missing"); },
      now: () => "2026-07-15T01:00:00Z",
      idFactory: () => draftRevisionId,
    });

    await expectApplicationError(
      () => app.publishDraftRevision({
        revision_id: draftRevisionId,
        publication_id: "21111111-1111-4111-8111-000000000001",
        confirmation: `PUBLISH:${definitionId}:${draftRevisionId}`,
      }),
      "VALIDATION_FAILED",
    );
    expect(publicationDriver.state.calls).not.toContain("write_snapshot");
  });

  it("rejects a publication confirmation that names a different draft", async () => {
    const draft = revision({ id: draftRevisionId, number: 2, status: "draft" });
    const persistence = createInMemoryBundlePersistenceAdapter({ definitions: [definition(publishedRevisionId)], revisions: [revision(), draft] });
    const app = createBundleAdminService({
      persistence,
      repository: createInMemoryBundleAdminRepository({ persistence }),
      publicationService: publishDraftRevision,
      publicationEnabled: true,
      publicationDriver: {},
      resolvePromotionEvidence: async () => ({}),
      now: () => "2026-07-15T01:00:00Z",
      idFactory: () => draftRevisionId,
    });

    await expectApplicationError(
      () => app.publishDraftRevision({
        revision_id: draftRevisionId,
        publication_id: "21111111-1111-4111-8111-000000000001",
        confirmation: "PUBLISH:other:other",
      }),
      "CONFLICT",
    );
  });

  it("returns compile checksum, size, counts, and active diff for a valid draft", async () => {
    const draft = revision({ id: draftRevisionId, number: 2, status: "draft" });
    draft.configuration.internal_name = "Draft naming change";
    const { app } = service({ definitions: [definition(publishedRevisionId)], revisions: [revision(), draft] });
    const preview = await app.compilePreview({ revision_id: draftRevisionId });

    expect(preview).toMatchObject({
      valid: true,
      configuration_version: 2,
      counts: { components: 8, groups: 4, presets: 2, rules: 2 },
    });
    expect(preview.snapshot_checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(preview.snapshot_byte_size).toBeGreaterThan(0);
    expect(preview.diff_from_active).toMatchObject({ active_revision_id: publishedRevisionId, exact: false });
    expect(preview.diff_from_active.differences.map((item) => item.path)).toContain("configuration.internal_name");
  });

  it.each([
    ["warning", { ok: true, sizeBytes: 7_501, warning: "snapshot_size_warning" }, true],
    ["hard rejection", { ok: false, reason: "snapshot_size_hard_limit", sizeBytes: 9_001 }, false],
  ])("reports Snapshot size %s", async (_label, result, expectedValid) => {
    const draft = revision({ id: draftRevisionId, number: 2, status: "draft" });
    const { app } = service({
      definitions: [definition()],
      revisions: [draft],
      sizeGuard: () => result,
    });
    const preview = await app.compilePreview({ revision_id: draftRevisionId });

    expect(preview.valid).toBe(expectedValid);
    expect(preview.snapshot_byte_size).toBe(result.sizeBytes);
    if (expectedValid) expect(preview.warnings).toContain("snapshot_size_warning");
    else expect(preview.errors).toContain("snapshot_size_hard_limit");
  });

  it("orders revision history newest first and compares a draft to active", async () => {
    const draft = revision({ id: draftRevisionId, number: 2, status: "draft" });
    const { app } = service({ definitions: [definition(publishedRevisionId)], revisions: [revision(), draft] });

    expect((await app.listRevisionHistory({ bundle_definition_id: definitionId })).map((item) => item.revision_number)).toEqual([2, 1]);
    expect(await app.compareDraftAgainstActive({ revision_id: draftRevisionId })).toMatchObject({
      active_revision_id: publishedRevisionId,
      exact: false,
    });
  });

  it("normalizes not-found and conflict errors and rejects cart instance IDs", async () => {
    const { app } = service();
    let notFound;
    try {
      await app.getBundleDetail({ bundle_definition_id: definitionId });
    } catch (error) {
      notFound = toApplicationErrorDto(error);
    }
    expect(notFound).toMatchObject({ code: "NOT_FOUND" });

    await app.createBundleDefinition({
      bundle_definition_id: definitionId,
      slug: "aces-master-kit",
      parent_binding: definition().parent_binding,
      created_by: "admin",
    });
    await expectApplicationError(() => app.createBundleDefinition({
      bundle_definition_id: "22222222-2222-4222-8222-000000000001",
      slug: "duplicate-parent",
      parent_binding: definition().parent_binding,
      created_by: "admin",
    }), "CONFLICT");
    const unsafe = config();
    unsafe._bundle_id = "cart-instance";
    await expectApplicationError(() => app.createDraftRevision({
      bundle_definition_id: definitionId,
      configuration: unsafe,
      created_by: "editor",
    }), "VALIDATION_FAILED");
  });
});

async function expectApplicationError(action, code) {
  try {
    await action();
  } catch (error) {
    expect(toApplicationErrorDto(error)).toMatchObject({ code });
    return;
  }
  throw new Error(`expected application error ${code}`);
}
