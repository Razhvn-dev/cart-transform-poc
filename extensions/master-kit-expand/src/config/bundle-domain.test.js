import { describe, expect, it } from "vitest";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import {
  createNextDraftRevision,
  createPublicationAttempt,
  createPublicationRetryIdentity,
  publishRevision,
  rollbackActiveRevision,
  transitionRevision,
  transitionPublicationAttempt,
  updateDraftRevision,
} from "./bundle-domain.lifecycle.js";
import {
  parseBundleDefinition,
  parseBundleRevision,
} from "./bundle-domain.parser.js";
import {
  BundleDomainValidationError,
  validateBundleDefinitionCollection,
  validateBundleDomain,
} from "./bundle-domain.validator.js";

const definitionId = "f6cf6c74-90a6-4f15-9e4f-2dbeb2fc4b89";
const publishedRevisionId = "0a9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef701";
const draftRevisionId = "1b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef702";
const at = "2026-07-15T00:00:00Z";

function snapshotRef(version = 1) {
  return {
    schema_version: "bundle_runtime.v1",
    checksum_algorithm: "fnv1a-32",
    checksum: version === 1 ? "1234abcd" : "5678abcd",
    configuration_version: version,
  };
}

function definition(overrides = {}) {
  return {
    schema_version: "bundle_definition.v1",
    bundle_definition_id: definitionId,
    slug: "aces-master-kit",
    parent_binding: {
      product_gid: masterKitConfigV1.parent.product_gid,
      variant_gid: masterKitConfigV1.parent.variant_gid,
    },
    active_revision_id: publishedRevisionId,
    created_at: at,
    updated_at: at,
    ...overrides,
  };
}

function revision({ id = publishedRevisionId, number = 1, status = "published", runtimeSnapshotRef = snapshotRef(number) } = {}) {
  const configuration = structuredClone(masterKitConfigV1);
  configuration.configuration_id = definitionId;
  configuration.configuration_version = number;
  configuration.status = status === "draft" ? "draft" : "active";
  configuration.revision.draft_revision = number;
  configuration.revision.published_revision = number;
  return {
    schema_version: "bundle_revision.v1",
    revision_id: id,
    bundle_definition_id: definitionId,
    revision_number: number,
    status,
    configuration,
    runtime_snapshot_ref: status === "draft" ? null : runtimeSnapshotRef,
    created_at: at,
    updated_at: at,
    created_by: "domain-test",
  };
}

describe("bundle domain contracts", () => {
  it("accepts a valid definition and published revision", () => {
    const parsedDefinition = parseBundleDefinition(definition());
    const parsedRevision = parseBundleRevision(revision());

    expect(validateBundleDomain({ definitions: [parsedDefinition], revisions: [parsedRevision] })).toEqual([]);
    expect(Object.isFrozen(parsedDefinition)).toBe(true);
    expect(Object.isFrozen(parsedRevision)).toBe(true);
  });

  it("allows draft revisions to be edited but rejects published mutation", () => {
    const draft = parseBundleRevision(revision({ id: draftRevisionId, number: 2, status: "draft" }));
    const updated = updateDraftRevision(draft, { updated_at: "2026-07-15T01:00:00Z", created_by: "editor" });

    expect(updated.created_by).toBe("editor");
    expect(() => updateDraftRevision(revision(), { updated_at: at }))
      .toThrow("only draft revisions are editable");
  });

  it.each(["published", "superseded", "archived"])("rejects edits to an immutable %s revision", (status) => {
    const immutable = revision({ status });
    expect(() => updateDraftRevision(immutable, { updated_at: "2026-07-15T01:00:00Z" }))
      .toThrow("only draft revisions are editable");
  });

  it("creates a monotonic next draft from a published revision", () => {
    const next = createNextDraftRevision({
      publishedRevision: revision(),
      revisionId: draftRevisionId,
      createdAt: "2026-07-15T01:00:00Z",
      createdBy: "editor",
    });

    expect(next.revision_number).toBe(2);
    expect(next.configuration.configuration_version).toBe(2);
    expect(next.runtime_snapshot_ref).toBeNull();
  });

  it("rejects a non-monotonic revision when publishing", () => {
    const current = revision({ number: 2, runtimeSnapshotRef: snapshotRef(2) });
    const invalidDraft = revision({ id: draftRevisionId, number: 1, status: "draft" });
    expect(() => publishRevision({
      definition: definition(),
      revisions: [current, invalidDraft],
      revisionId: draftRevisionId,
      runtimeSnapshotRef: snapshotRef(1),
      updatedAt: "2026-07-15T01:00:00Z",
    })).toThrow("published revision_number must be greater");
  });

  it("rejects duplicate parent variant bindings", () => {
    const second = definition({
      bundle_definition_id: "2b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef703",
      active_revision_id: null,
    });
    expect(validateBundleDefinitionCollection([definition(), second]))
      .toContain(`duplicate parent variant binding "${masterKitConfigV1.parent.variant_gid}"`);
  });

  it("rejects an invalid active revision pointer", () => {
    expect(validateBundleDomain({
      definitions: [definition({ active_revision_id: draftRevisionId })],
      revisions: [revision(), revision({ id: draftRevisionId, number: 2, status: "draft" })],
    })).toContain("definitions[0].active_revision_id must reference a published revision");
  });

  it("uses a stable publication retry identity across retries", () => {
    const published = parseBundleRevision(revision());
    const first = createPublicationAttempt({
      publicationId: "3b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef704",
      revision: published,
      previousActiveRevisionId: null,
      attemptNumber: 1,
      createdAt: at,
    });
    const retry = createPublicationAttempt({
      publicationId: "4b9b0e1d-0f9f-4ea4-8bb4-1f2dc1aef705",
      revision: published,
      previousActiveRevisionId: null,
      attemptNumber: 2,
      createdAt: at,
    });

    expect(first.retry_identity).toBe(retry.retry_identity);
    expect(first.retry_identity).toBe(createPublicationRetryIdentity({
      bundleDefinitionId: definitionId,
      revisionId: publishedRevisionId,
      checksum: "1234abcd",
    }));
    expect(transitionPublicationAttempt(first, "compiled", "2026-07-15T01:00:00Z").state).toBe("compiled");
    expect(() => transitionPublicationAttempt(first, "recorded", "2026-07-15T01:00:00Z"))
      .toThrow("publication attempt transition pending -> recorded is not allowed");
    expect(() => transitionRevision(revision({ id: draftRevisionId, number: 2, status: "draft" }), "superseded", at))
      .toThrow("revision transition draft -> superseded is not allowed");
  });

  it("supersedes and rolls back through the active definition pointer", () => {
    const previous = revision();
    const candidate = revision({ id: draftRevisionId, number: 2, status: "draft" });
    const published = publishRevision({
      definition: definition(),
      revisions: [previous, candidate],
      revisionId: draftRevisionId,
      runtimeSnapshotRef: snapshotRef(2),
      updatedAt: "2026-07-15T01:00:00Z",
    });

    expect(published.definition.active_revision_id).toBe(draftRevisionId);
    expect(published.revisions.find((item) => item.revision_id === publishedRevisionId).status).toBe("superseded");
    const rolledBack = rollbackActiveRevision({
      ...published,
      targetRevisionId: publishedRevisionId,
      updatedAt: "2026-07-15T02:00:00Z",
    });
    expect(rolledBack.definition.active_revision_id).toBe(publishedRevisionId);
    expect(rolledBack.revisions.find((item) => item.revision_id === draftRevisionId).status).toBe("superseded");
  });

  it("keeps bundle_definition_id separate from per-cart _bundle_id", () => {
    expect(() => parseBundleDefinition(definition({ _bundle_id: "cart-instance-uuid" })))
      .toThrow(BundleDomainValidationError);
    expect(() => parseBundleRevision({ ...revision(), bundle_id: "wrong-domain-id" }))
      .toThrow("reserved for per-cart bundle instances");
  });
});
