import { describe, expect, it } from "vitest";

import { createInMemoryBundlePersistenceAdapter } from "../extensions/master-kit-expand/src/config/bundle-persistence.in-memory-adapter.js";
import { createPrebuiltBundleImportPlanFromPackage } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.package.js";
import { importFixture } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.plan.test-fixture.js";
import { createDevCatalogTechnicalBatchExecutionManifest } from "./dev-catalog-technical-batch-execution-manifest.js";
import { executeDevCatalogTechnicalBatch } from "./dev-catalog-technical-batch-executor.js";

function fixture({ failures = {} } = {}) {
  const packageValue = importFixture();
  packageValue.mappings[0].configuration.status = "active";
  packageValue.mappings[0].configuration.audit = {
    ...packageValue.mappings[0].configuration.audit,
    published_at: "2026-07-21T09:30:00.000Z",
    published_by: "executor-test",
  };
  const planned = createPrebuiltBundleImportPlanFromPackage(packageValue);
  const record = planned.plan.records[0];
  const createdAt = record.target.configuration.audit.published_at;
  const importReview = {
    batch_id: "batch",
    package_fingerprint: planned.fingerprint,
    import_package: packageValue,
    plan: planned.plan,
  };
  const drafts = {
    batch_id: "batch",
    records: [{
      status: "draft_ready",
      draft: {
        definition: { bundle_definition_id: record.target.bundle_definition_id },
        revision: { revision_id: "10000000-0000-5000-8000-000000000001" },
      },
    }],
  };
  const manifest = createDevCatalogTechnicalBatchExecutionManifest({
    importReview,
    drafts,
    collisions: { batch_id: "batch", summary: { blocked: 0 } },
    scope: { batch_id: "batch", draft_created_at: createdAt, draft_created_by: record.target.configuration.audit.published_by },
  });
  const base = createInMemoryBundlePersistenceAdapter({ failures });
  const ledger = new Map();
  const persistence = {
    ...base,
    async readPrebuiltImportLedger(sourceIdentity) {
      return structuredClone(ledger.get(sourceIdentity) ?? null);
    },
    async writePrebuiltImportLedger(value) {
      const current = ledger.get(value.source_identity);
      if (current && current.state !== "pending") throw new Error("terminal ledger is immutable");
      ledger.set(value.source_identity, structuredClone(value));
      return structuredClone(value);
    },
  };
  return { importReview, manifest, persistence, ledger, record };
}

describe("development catalogue technical batch executor", () => {
  it("reconciles without writes by default", async () => {
    const value = fixture();
    const result = await executeDevCatalogTechnicalBatch({
      importReview: value.importReview,
      manifest: value.manifest,
      persistence: value.persistence,
    });
    expect(result).toMatchObject({
      mode: "read_only_reconciliation",
      shopify_writes_performed: false,
    });
    expect(result.results[0]).toMatchObject({ status: "ready_to_apply" });
    expect(value.ledger.size).toBe(0);
  });

  it("applies, verifies, and treats a repeated execution as already complete", async () => {
    const value = fixture();
    const input = {
      importReview: value.importReview,
      manifest: value.manifest,
      persistence: value.persistence,
      apply: true,
      confirmation: value.manifest.exact_apply_confirmation,
    };
    const completed = await executeDevCatalogTechnicalBatch(input);
    const repeated = await executeDevCatalogTechnicalBatch(input);
    expect(completed).toMatchObject({
      shopify_writes_performed: true,
      results: [{ status: "completed" }],
    });
    expect(repeated).toMatchObject({
      shopify_writes_performed: false,
      results: [{ status: "already_completed" }],
    });
    expect(value.ledger.get(value.record.source_identity).state).toBe("completed");
  });

  it("leaves an exact pending ledger after a partial write and resumes it", async () => {
    const value = fixture({ failures: { writeRevision: new Error("transport unavailable") } });
    const input = {
      importReview: value.importReview,
      manifest: value.manifest,
      persistence: value.persistence,
      apply: true,
      confirmation: value.manifest.exact_apply_confirmation,
    };
    await expect(executeDevCatalogTechnicalBatch(input)).rejects.toMatchObject({
      details: { completed_steps: ["definition_staged"], recovery_required: true },
    });
    expect(value.ledger.get(value.record.source_identity).state).toBe("pending");

    const resumedPersistence = { ...value.persistence };
    delete resumedPersistence.state;
    const base = createInMemoryBundlePersistenceAdapter({
      definitions: [...value.persistence.state.definitionStore.values()],
    });
    Object.assign(resumedPersistence, base, {
      readPrebuiltImportLedger: value.persistence.readPrebuiltImportLedger,
      writePrebuiltImportLedger: value.persistence.writePrebuiltImportLedger,
    });
    const resumed = await executeDevCatalogTechnicalBatch({ ...input, persistence: resumedPersistence });
    expect(resumed.results[0]).toMatchObject({ status: "completed" });
  });

  it("fails closed when the exact confirmation is absent", async () => {
    const value = fixture();
    await expect(executeDevCatalogTechnicalBatch({
      importReview: value.importReview,
      manifest: value.manifest,
      persistence: value.persistence,
      apply: true,
    })).rejects.toThrow("exact development apply confirmation is required");
  });

  it("accepts only fresh clean read-only reconciliation evidence", async () => {
    const value = fixture();
    const frozen = value.manifest.records[0];
    const evidence = {
      schema_version: "dev_catalog_technical_batch_target_reconciliation.v1",
      mode: "read_only",
      captured_at: new Date().toISOString(),
      manifest_checksum: value.manifest.checksum,
      shopify_writes_performed: false,
      source_identity: value.record.source_identity,
      expected: {
        definition_id: frozen.bundle_definition_id,
        revision_id: frozen.revision_id,
        publication_id: frozen.publication_id,
        snapshot_checksum: frozen.snapshot_checksum,
        projection_checksum: frozen.projection_checksum,
      },
      observed: {
        definition: null, revision: null, publication: null, snapshot: null,
        projection: null, active_revision_id: null, ledger: null,
      },
    };
    const result = await executeDevCatalogTechnicalBatch({
      importReview: value.importReview,
      manifest: value.manifest,
      persistence: value.persistence,
      apply: true,
      confirmation: value.manifest.exact_apply_confirmation,
      reconciliationEvidence: evidence,
    });
    expect(result.results[0]).toMatchObject({ status: "completed" });
    await expect(executeDevCatalogTechnicalBatch({
      importReview: value.importReview,
      manifest: value.manifest,
      persistence: value.persistence,
      sourceIdentity: value.record.source_identity,
      reconciliationEvidence: { ...evidence, captured_at: "2020-01-01T00:00:00.000Z" },
    })).rejects.toThrow("trusted reconciliation evidence is stale");
  });
});
