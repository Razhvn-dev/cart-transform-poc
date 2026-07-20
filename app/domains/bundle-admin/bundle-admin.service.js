import { validateBundleRevision } from "../../../extensions/master-kit-expand/src/config/bundle-domain.validator.js";
import { createNextDraftRevision, updateDraftRevision } from "../../../extensions/master-kit-expand/src/config/bundle-domain.lifecycle.js";
import { parseBundleDefinition, parseBundleRevision } from "../../../extensions/master-kit-expand/src/config/bundle-domain.parser.js";
import { BundlePersistenceError, normalizeBundlePersistenceError } from "../../../extensions/master-kit-expand/src/config/bundle-persistence.adapter.js";
import { compileRuntimeSnapshot } from "../../../extensions/master-kit-expand/src/config/bundle-runtime.compiler.js";
import { assertRuntimeSnapshotMetafieldSize } from "../../../extensions/master-kit-expand/src/config/bundle-runtime.snapshot-size.js";
import { createPrebuiltBundleImportPlan } from "../../../extensions/master-kit-expand/src/config/prebuilt-bundle-import.plan.js";
import { createPrebuiltBundleImportPlanFromPackage, parsePrebuiltBundleImportPackage } from "../../../extensions/master-kit-expand/src/config/prebuilt-bundle-import.package.js";
import { createDeclarativePrebuiltBundleSourceAdapter } from "../../../extensions/master-kit-expand/src/config/prebuilt-bundle-import.declarative-source.js";
import { createPrebuiltBundleImportPackageFromSource } from "../../../extensions/master-kit-expand/src/config/prebuilt-bundle-import.source-package.js";

export const BUNDLE_ADMIN_ERROR_CODES = Object.freeze([
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_FAILED",
  "IMMUTABLE_REVISION",
  "COMPILATION_FAILED",
  "UNSUPPORTED_CAPABILITY",
  "PERSISTENCE_FAILED",
]);

export class BundleAdminApplicationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "BundleAdminApplicationError";
    this.code = code;
    this.details = details;
  }
}

export function createBundleAdminService({
  persistence,
  repository,
  publicationService,
  rollbackService = null,
  publicationDriver = null,
  publicationEnabled = false,
  prebuiltImportExecutionEnabled = false,
  prebuiltImportExecutor = null,
  prebuiltImportLedger = null,
  createPrebuiltImportTargetWriter = null,
  resolvePromotionEvidence = null,
  compile = compileRuntimeSnapshot,
  sizeGuard = assertRuntimeSnapshotMetafieldSize,
  now = () => new Date().toISOString(),
  idFactory,
}) {
  assertDependencies({ persistence, repository, publicationService, idFactory });

  return {
    async listBundles() {
      try {
        const definitions = await repository.listBundleDefinitions();
        return await Promise.all(definitions
          .sort((left, right) => left.slug.localeCompare(right.slug))
          .map(async (definition) => toBundleSummary(
            definition,
            await repository.listRevisionsByDefinition(definition.bundle_definition_id),
          )));
      } catch (error) {
        throw normalizeApplicationError(error);
      }
    },

    async getBundleDetail({ bundle_definition_id: bundleDefinitionId }) {
      const definition = await readDefinition(persistence, bundleDefinitionId);
      const revisions = await listRevisions(repository, bundleDefinitionId);
      return {
        ...toBundleDetail(definition, revisions),
        publication: {
          enabled: publicationEnabled,
          requires_server_evidence: true,
        },
      };
    },

    async createBundleDefinition({ bundle_definition_id: bundleDefinitionId = idFactory(), slug, parent_binding: parentBinding, created_by }) {
      try {
        const definitions = await repository.listBundleDefinitions();
        if (definitions.some((definition) => definition.bundle_definition_id === bundleDefinitionId)) {
          throw new BundleAdminApplicationError("CONFLICT", "bundle_definition_id already exists");
        }
        if (definitions.some((definition) => definition.parent_binding.variant_gid === parentBinding?.variant_gid)) {
          throw new BundleAdminApplicationError("CONFLICT", "parent variant is already bound to another bundle definition");
        }
        const timestamp = now();
        const definition = parseBundleDefinition({
          schema_version: "bundle_definition.v1",
          bundle_definition_id: bundleDefinitionId,
          slug,
          parent_binding: parentBinding,
          active_revision_id: null,
          created_at: timestamp,
          updated_at: timestamp,
        });
        await persistence.writeBundleDefinition({ definition, created_by });
        return toBundleDetail(definition, []);
      } catch (error) {
        throw normalizeApplicationError(error);
      }
    },

    async updateBundleDefinition({ bundle_definition_id: bundleDefinitionId, slug, parent_binding: parentBinding, updated_by }) {
      try {
        const existing = await readDefinition(persistence, bundleDefinitionId);
        const definitions = await repository.listBundleDefinitions();
        const revisions = await listRevisions(repository, bundleDefinitionId);
        if (definitions.some((definition) => (
          definition.bundle_definition_id !== bundleDefinitionId
          && definition.parent_binding.variant_gid === parentBinding?.variant_gid
        ))) {
          throw new BundleAdminApplicationError("CONFLICT", "parent variant is already bound to another bundle definition");
        }
        if (revisions.length > 0 && !sameParentBinding(existing.parent_binding, parentBinding)) {
          throw new BundleAdminApplicationError(
            "CONFLICT",
            "parent binding is immutable after the first revision; create a new bundle definition for a different parent variant",
          );
        }
        const definition = parseBundleDefinition({
          ...existing,
          slug,
          parent_binding: parentBinding,
          updated_at: now(),
        });
        await persistence.writeBundleDefinition({ definition, updated_by });
        return toBundleDetail(definition, revisions);
      } catch (error) {
        throw normalizeApplicationError(error);
      }
    },

    async createDraftRevision({ bundle_definition_id: bundleDefinitionId, configuration, created_by, revision_id: revisionId = idFactory() }) {
      try {
        const definition = await readDefinition(persistence, bundleDefinitionId);
        assertNoBundleInstanceId(configuration, "configuration");
        const revisions = await listRevisions(repository, bundleDefinitionId);
        const revisionNumber = nextRevisionNumber(revisions);
        const timestamp = now();
        const draft = parseBundleRevision({
          schema_version: "bundle_revision.v1",
          revision_id: revisionId,
          bundle_definition_id: bundleDefinitionId,
          revision_number: revisionNumber,
          status: "draft",
          configuration: normalizeDraftConfiguration(configuration, definition, revisionNumber),
          runtime_snapshot_ref: null,
          created_at: timestamp,
          updated_at: timestamp,
          created_by,
        });
        await persistence.writeRevision({ revision: draft });
        return toRevisionDetail(draft);
      } catch (error) {
        throw normalizeApplicationError(error);
      }
    },

    async cloneActiveRevisionToDraft({ bundle_definition_id: bundleDefinitionId, created_by, revision_id: revisionId = idFactory() }) {
      try {
        const definition = await readDefinition(persistence, bundleDefinitionId);
        if (!definition.active_revision_id) {
          throw new BundleAdminApplicationError("CONFLICT", "bundle definition has no active revision to clone");
        }
        const active = await readRevision(persistence, definition.active_revision_id);
        const draft = createNextDraftRevision({
          publishedRevision: active,
          revisionId,
          createdAt: now(),
          createdBy: created_by,
        });
        await persistence.writeRevision({ revision: draft });
        return toRevisionDetail(draft);
      } catch (error) {
        throw normalizeApplicationError(error);
      }
    },

    async updateDraftRevision({ revision_id: revisionId, configuration, updated_by }) {
      try {
        assertNoBundleInstanceId(configuration, "configuration");
        const existing = await readRevision(persistence, revisionId);
        if (existing.status !== "draft") {
          throw new BundleAdminApplicationError("IMMUTABLE_REVISION", "only draft revisions may be updated");
        }
        const definition = await readDefinition(persistence, existing.bundle_definition_id);
        const updated = updateDraftRevision(existing, {
          configuration: normalizeDraftConfiguration(configuration, definition, existing.revision_number),
          updated_at: now(),
          created_by: updated_by ?? existing.created_by,
        });
        await persistence.writeRevision({ revision: updated });
        return toRevisionDetail(updated);
      } catch (error) {
        throw normalizeApplicationError(error);
      }
    },

    async listRevisionHistory({ bundle_definition_id: bundleDefinitionId }) {
      await readDefinition(persistence, bundleDefinitionId);
      return (await listRevisions(repository, bundleDefinitionId))
        .sort((left, right) => right.revision_number - left.revision_number)
        .map(toRevisionSummary);
    },

    async listPublicationHistory({ bundle_definition_id: bundleDefinitionId }) {
      try {
        await readDefinition(persistence, bundleDefinitionId);
        const records = await repository.listPublicationRecordsByDefinition(bundleDefinitionId);
        return records
          .map(toPublicationSummary)
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
      } catch (error) {
        throw normalizeApplicationError(error);
      }
    },

    async validateDraft({ revision_id: revisionId }) {
      const revision = await readRevision(persistence, revisionId);
      if (revision.status !== "draft") {
        throw new BundleAdminApplicationError("IMMUTABLE_REVISION", "only draft revisions may be validated");
      }
      const errors = validateBundleRevision(revision);
      return {
        revision: toRevisionSummary(revision),
        valid: errors.length === 0,
        errors,
        warnings: [],
      };
    },

    async compilePreview({ revision_id: revisionId }) {
      const revision = await readRevision(persistence, revisionId);
      if (revision.status !== "draft") {
        throw new BundleAdminApplicationError("IMMUTABLE_REVISION", "only draft revisions may be compiled for preview");
      }
      const validation = await this.validateDraft({ revision_id: revisionId });
      const diffFromActive = await compareRevisionWithActive(persistence, repository, revision);
      if (!validation.valid) {
        return {
          ...validation,
          snapshot_checksum: null,
          snapshot_byte_size: null,
          configuration_version: revision.revision_number,
          counts: countConfiguration(revision.configuration),
          diff_from_active: diffFromActive,
        };
      }
      try {
        const snapshot = compile(revision.configuration);
        const size = sizeGuard({ jsonValue: snapshot });
        return {
          ...validation,
          valid: size.ok,
          errors: size.ok ? [] : [size.reason],
          warnings: size.warning ? [size.warning] : [],
          snapshot_checksum: snapshot.checksum,
          snapshot_byte_size: size.sizeBytes,
          configuration_version: snapshot.configuration_version,
          counts: countConfiguration(revision.configuration),
          diff_from_active: diffFromActive,
        };
      } catch (error) {
        throw normalizeApplicationError(error, "COMPILATION_FAILED");
      }
    },

    async compareDraftAgainstActive({ revision_id: revisionId }) {
      const revision = await readRevision(persistence, revisionId);
      if (revision.status !== "draft") {
        throw new BundleAdminApplicationError("IMMUTABLE_REVISION", "only draft revisions may be compared against active revisions");
      }
      return compareRevisionWithActive(persistence, repository, revision);
    },

    // This is a read-only review command. It never creates a Definition or
    // Revision and cannot reach any Snapshot/pointer publication operation.
    async reviewPrebuiltBundleImport({
      import_id: importId,
      source_records: sourceRecords,
      mappings,
      pilot_scope: pilotScope,
      import_package: importPackage,
      raw_source_export: rawSourceExport,
      source_mapping_profile: sourceMappingProfile,
    }) {
      try {
        const definitions = await repository.listBundleDefinitions();
        const existingParentVariants = definitions.map((definition) => definition.parent_binding?.variant_gid).filter(Boolean);
        const existingParentBindings = definitions.map((definition) => ({
          bundle_definition_id: definition.bundle_definition_id,
          product_gid: definition.parent_binding?.product_gid,
          variant_gid: definition.parent_binding?.variant_gid,
        }));
        if (importPackage !== undefined) {
          const result = createPrebuiltBundleImportPlanFromPackage(importPackage, {
            existing_parent_variant_gids: existingParentVariants,
            existing_parent_bindings: existingParentBindings,
          });
          if (!result.ok) {
            throw new BundleAdminApplicationError("VALIDATION_FAILED", "import package is invalid", { errors: result.errors });
          }
          return result.plan;
        }
        if (rawSourceExport !== undefined || sourceMappingProfile !== undefined) {
          if (rawSourceExport === undefined || sourceMappingProfile === undefined) {
            throw new BundleAdminApplicationError(
              "VALIDATION_FAILED",
              "raw_source_export and source_mapping_profile must be supplied together",
            );
          }
          const adapter = createDeclarativePrebuiltBundleSourceAdapter({
            profile: sourceMappingProfile,
            export_document: rawSourceExport,
          });
          const packageResult = await createPrebuiltBundleImportPackageFromSource({
            adapter,
            import_id: importId,
            mappings,
            pilot_scope: pilotScope,
          });
          if (!packageResult.ok) {
            throw new BundleAdminApplicationError("VALIDATION_FAILED", "normalized import package is invalid", { errors: packageResult.errors });
          }
          const result = createPrebuiltBundleImportPlanFromPackage(packageResult.value, {
            existing_parent_variant_gids: existingParentVariants,
            existing_parent_bindings: existingParentBindings,
          });
          if (!result.ok) {
            throw new BundleAdminApplicationError("VALIDATION_FAILED", "normalized import package is invalid", { errors: result.errors });
          }
          return {
            ...result.plan,
            source_export: adapter.source_export,
            package_fingerprint: packageResult.fingerprint,
          };
        }
        return createPrebuiltBundleImportPlan({
          import_id: importId,
          source_records: sourceRecords,
          mappings,
          pilot_scope: pilotScope,
          existing_parent_variant_gids: existingParentVariants,
          existing_parent_bindings: existingParentBindings,
        });
      } catch (error) {
        throw normalizeApplicationError(error);
      }
    },

    async executePrebuiltBundleImport({
      import_id: importId,
      source_records: sourceRecords,
      mappings,
      pilot_scope: pilotScope,
      import_package: importPackage,
      confirmation_token: confirmationToken,
      confirmation,
    }) {
      if (!prebuiltImportExecutionEnabled) {
        throw new BundleAdminApplicationError("UNSUPPORTED_CAPABILITY", "pre-built import execution is disabled");
      }
      if (typeof prebuiltImportExecutor !== "function"
        || typeof prebuiltImportLedger?.read !== "function"
        || typeof prebuiltImportLedger?.write !== "function"
        || typeof createPrebuiltImportTargetWriter !== "function") {
        throw new BundleAdminApplicationError(
          "UNSUPPORTED_CAPABILITY",
          "pre-built import execution requires a persistent ledger and target writer",
        );
      }

      let resolvedPilotScope = pilotScope;
      if (importPackage !== undefined) {
        const parsed = parsePrebuiltBundleImportPackage(importPackage);
        if (!parsed.ok) {
          throw new BundleAdminApplicationError("VALIDATION_FAILED", "import package is invalid", { errors: parsed.errors });
        }
        resolvedPilotScope = parsed.value.pilot_scope;
      }
      const plan = await this.reviewPrebuiltBundleImport({
        import_id: importId,
        source_records: sourceRecords,
        mappings,
        pilot_scope: resolvedPilotScope,
        import_package: importPackage,
      });
      const expectedConfirmation = `IMPORT:${plan.import_id}:${plan.confirmation_token}`;
      if (confirmationToken !== plan.confirmation_token || confirmation !== expectedConfirmation) {
        throw new BundleAdminApplicationError("CONFLICT", "import confirmation does not match the server-reviewed plan");
      }
      if (plan.summary.ready_for_confirmation === 0) {
        throw new BundleAdminApplicationError("VALIDATION_FAILED", "import plan has no records ready for execution");
      }

      try {
        await assertExistingImportTargetsAreCompleted({ plan, ledger: prebuiltImportLedger });
        return await prebuiltImportExecutor({
          plan,
          confirmation_token: confirmationToken,
          ledger: prebuiltImportLedger,
          create_target: createPrebuiltImportTargetWriter({ pilot_scope: resolvedPilotScope }),
          now,
        });
      } catch (error) {
        throw normalizeApplicationError(error);
      }
    },

    // This is deliberately a read-only preflight. Publishing remains unavailable
    // until a separately authorized command can supply real promotion evidence.
    async prepareDraftPublication({ revision_id: revisionId }) {
      const revision = await readRevision(persistence, revisionId);
      if (revision.status !== "draft") {
        throw new BundleAdminApplicationError("IMMUTABLE_REVISION", "only draft revisions may be prepared for publication");
      }

      const preview = await this.compilePreview({ revision_id: revisionId });
      const blockers = preview.valid
        ? []
        : preview.errors.map((message) => ({ code: "DRAFT_NOT_READY", message }));

      return {
        revision: toRevisionSummary(revision),
        local_preflight_passed: blockers.length === 0,
        blockers,
        warnings: preview.warnings,
        snapshot_checksum: preview.snapshot_checksum,
        snapshot_byte_size: preview.snapshot_byte_size,
        configuration_version: preview.configuration_version,
        diff_from_active: preview.diff_from_active,
        required_before_publish: ["runtime_promotion_parity", "explicit_publish_authorization"],
      };
    },

    async publishDraftRevision({ revision_id: revisionId, publication_id: publicationId, confirmation }) {
      if (!publicationEnabled) {
        throw new BundleAdminApplicationError("UNSUPPORTED_CAPABILITY", "publication command is disabled");
      }
      if (typeof publicationId !== "string" || publicationId.trim() === "") {
        throw new BundleAdminApplicationError("VALIDATION_FAILED", "publication_id is required");
      }
      const revision = await readRevision(persistence, revisionId);
      if (confirmation !== publicationConfirmation(revision.bundle_definition_id, revisionId)) {
        throw new BundleAdminApplicationError("CONFLICT", "publication confirmation does not match the target draft");
      }
      if (typeof publicationDriver !== "object" || typeof resolvePromotionEvidence !== "function") {
        throw new BundleAdminApplicationError(
          "UNSUPPORTED_CAPABILITY",
          "publication command requires server-side persistence and promotion evidence",
        );
      }

      const preflight = await this.prepareDraftPublication({ revision_id: revisionId });
      if (!preflight.local_preflight_passed) {
        throw new BundleAdminApplicationError("VALIDATION_FAILED", "draft did not pass publication preflight", preflight);
      }

      const definition = await readDefinition(persistence, revision.bundle_definition_id);
      const revisions = await listRevisions(repository, revision.bundle_definition_id);
      let promotion;
      try {
        promotion = await resolvePromotionEvidence({
          definition,
          revision,
          revisions,
          snapshot_checksum: preflight.snapshot_checksum,
        });
      } catch (error) {
        throw new BundleAdminApplicationError(
          "VALIDATION_FAILED",
          "publication promotion evidence is unavailable or invalid",
          { source: "promotion_evidence", reason: error instanceof Error ? error.message : String(error) },
        );
      }
      return publicationService({
        publication_id: publicationId,
        definition,
        revisions,
        revision_id: revisionId,
        promotion,
        at: now(),
      }, publicationDriver);
    },

    async prepareRevisionRollback({ revision_id: revisionId }) {
      const revision = await readRevision(persistence, revisionId);
      if (revision.status !== "superseded") {
        throw new BundleAdminApplicationError("CONFLICT", "only a superseded revision may be prepared for rollback");
      }
      const definition = await readDefinition(persistence, revision.bundle_definition_id);
      const revisions = await listRevisions(repository, revision.bundle_definition_id);
      const active = revisions.find((candidate) => candidate.revision_id === definition.active_revision_id);
      if (active?.status !== "published") {
        throw new BundleAdminApplicationError("CONFLICT", "rollback requires a published active revision");
      }
      const preview = compilePublicationTarget(revision, compile, sizeGuard);
      const blockers = preview.valid
        ? []
        : preview.errors.map((message) => ({ code: "ROLLBACK_TARGET_NOT_READY", message }));
      return {
        target_revision: toRevisionSummary(revision),
        active_revision: toRevisionSummary(active),
        local_preflight_passed: blockers.length === 0,
        blockers,
        warnings: preview.warnings,
        snapshot_checksum: preview.snapshot_checksum,
        snapshot_byte_size: preview.snapshot_byte_size,
        configuration_version: preview.configuration_version,
        required_before_rollback: ["runtime_promotion_parity", "explicit_publish_authorization"],
      };
    },

    async rollbackPublishedRevision({ revision_id: revisionId, publication_id: publicationId, confirmation }) {
      if (!publicationEnabled) {
        throw new BundleAdminApplicationError("UNSUPPORTED_CAPABILITY", "rollback command is disabled");
      }
      if (typeof rollbackService !== "function") {
        throw new BundleAdminApplicationError("UNSUPPORTED_CAPABILITY", "rollback service is unavailable");
      }
      if (typeof publicationId !== "string" || publicationId.trim() === "") {
        throw new BundleAdminApplicationError("VALIDATION_FAILED", "publication_id is required");
      }
      const revision = await readRevision(persistence, revisionId);
      if (confirmation !== rollbackConfirmation(revision.bundle_definition_id, revisionId)) {
        throw new BundleAdminApplicationError("CONFLICT", "rollback confirmation does not match the target revision");
      }
      if (typeof publicationDriver !== "object" || typeof resolvePromotionEvidence !== "function") {
        throw new BundleAdminApplicationError(
          "UNSUPPORTED_CAPABILITY",
          "rollback command requires server-side persistence and promotion evidence",
        );
      }

      const preflight = await this.prepareRevisionRollback({ revision_id: revisionId });
      if (!preflight.local_preflight_passed) {
        throw new BundleAdminApplicationError("VALIDATION_FAILED", "rollback target did not pass local preflight", preflight);
      }
      const definition = await readDefinition(persistence, revision.bundle_definition_id);
      const revisions = await listRevisions(repository, revision.bundle_definition_id);
      let promotion;
      try {
        promotion = await resolvePromotionEvidence({
          definition,
          revision,
          revisions,
          snapshot_checksum: preflight.snapshot_checksum,
        });
      } catch (error) {
        throw new BundleAdminApplicationError(
          "VALIDATION_FAILED",
          "rollback promotion evidence is unavailable or invalid",
          { source: "promotion_evidence", reason: error instanceof Error ? error.message : String(error) },
        );
      }
      return rollbackService({
        publication_id: publicationId,
        definition,
        revisions,
        target_revision_id: revisionId,
        target_snapshot: compile(revision.configuration),
        promotion,
        at: now(),
      }, publicationDriver);
    },
  };
}

async function assertExistingImportTargetsAreCompleted({ plan, ledger }) {
  for (const record of plan.records.filter((candidate) => candidate.status === "ready_for_confirmation")) {
    if (record.existing_target !== true) continue;
    const existing = await ledger.read(record.source_identity);
    const exactCompleted = existing?.state === "completed"
      && existing.import_id === plan.import_id
      && existing.source_fingerprint === record.source_fingerprint
      && existing.target_bundle_definition_id === record.target.bundle_definition_id
      && existing.target_fingerprint === record.target_fingerprint;
    if (!exactCompleted) {
      throw new BundleAdminApplicationError(
        "CONFLICT",
        `existing import target ${record.target.bundle_definition_id} has no matching completed ledger record`,
      );
    }
  }
}

export function toApplicationErrorDto(error) {
  const normalized = normalizeApplicationError(error);
  return { code: normalized.code, message: normalized.message, details: normalized.details ?? null };
}

function assertDependencies({ persistence, repository, publicationService, idFactory }) {
  for (const method of ["readBundleDefinition", "writeBundleDefinition", "readRevision", "writeRevision"]) {
    if (typeof persistence?.[method] !== "function") {
      throw new BundleAdminApplicationError("UNSUPPORTED_CAPABILITY", `persistence adapter is missing ${method}`);
    }
  }
  for (const method of ["listBundleDefinitions", "listRevisionsByDefinition", "listPublicationRecordsByDefinition"]) {
    if (typeof repository?.[method] !== "function") {
      throw new BundleAdminApplicationError("UNSUPPORTED_CAPABILITY", `query repository is missing ${method}`);
    }
  }
  if (typeof publicationService !== "function" || typeof idFactory !== "function") {
    throw new BundleAdminApplicationError("UNSUPPORTED_CAPABILITY", "application service dependencies are incomplete");
  }
}

async function readDefinition(persistence, bundleDefinitionId) {
  try {
    return await persistence.readBundleDefinition(bundleDefinitionId);
  } catch (error) {
    throw normalizeApplicationError(error);
  }
}

async function readRevision(persistence, revisionId) {
  try {
    return await persistence.readRevision(revisionId);
  } catch (error) {
    throw normalizeApplicationError(error);
  }
}

async function listRevisions(repository, bundleDefinitionId) {
  return repository.listRevisionsByDefinition(bundleDefinitionId);
}

function nextRevisionNumber(revisions) {
  return revisions.reduce((maximum, revision) => Math.max(maximum, revision.revision_number), 0) + 1;
}

function normalizeDraftConfiguration(configuration, definition, revisionNumber) {
  const normalized = structuredClone(configuration);
  normalized.configuration_id = definition.bundle_definition_id;
  normalized.configuration_version = revisionNumber;
  normalized.status = "draft";
  normalized.revision = {
    ...normalized.revision,
    draft_revision: revisionNumber,
    published_revision: Math.max(1, normalized.revision?.published_revision ?? revisionNumber),
  };
  return normalized;
}

function publicationConfirmation(bundleDefinitionId, revisionId) {
  return `PUBLISH:${bundleDefinitionId}:${revisionId}`;
}

function rollbackConfirmation(bundleDefinitionId, revisionId) {
  return `ROLLBACK:${bundleDefinitionId}:${revisionId}`;
}

function compilePublicationTarget(revision, compile, sizeGuard) {
  const errors = validateBundleRevision(revision);
  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings: [],
      snapshot_checksum: null,
      snapshot_byte_size: null,
      configuration_version: revision.revision_number,
    };
  }
  try {
    const snapshot = compile(revision.configuration);
    const size = sizeGuard({ jsonValue: snapshot });
    return {
      valid: size.ok,
      errors: size.ok ? [] : [size.reason],
      warnings: size.warning ? [size.warning] : [],
      snapshot_checksum: snapshot.checksum,
      snapshot_byte_size: size.sizeBytes,
      configuration_version: snapshot.configuration_version,
    };
  } catch (error) {
    throw normalizeApplicationError(error, "COMPILATION_FAILED");
  }
}

function sameParentBinding(left, right) {
  return left?.product_gid === right?.product_gid && left?.variant_gid === right?.variant_gid;
}

async function compareRevisionWithActive(persistence, repository, draft) {
  const definition = await readDefinition(persistence, draft.bundle_definition_id);
  if (!definition.active_revision_id) {
    return { active_revision_id: null, exact: false, differences: [], warnings: ["no_active_revision"] };
  }
  const active = (await repository.listRevisionsByDefinition(definition.bundle_definition_id))
    .find((revision) => revision.revision_id === definition.active_revision_id);
  if (!active) {
    throw new BundleAdminApplicationError("CONFLICT", "active revision pointer does not resolve in the query repository");
  }
  const differences = compareValues(active.configuration, draft.configuration);
  return {
    active_revision_id: active.revision_id,
    exact: differences.length === 0,
    differences,
    warnings: [],
  };
}

function compareValues(left, right, path = "configuration") {
  if (Object.is(left, right)) return [];
  const leftObject = isPlainObject(left);
  const rightObject = isPlainObject(right);
  if (Array.isArray(left) && Array.isArray(right)) {
    const differences = [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) differences.push(...compareValues(left[index], right[index], `${path}[${index}]`));
    return differences;
  }
  if (leftObject && rightObject) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].sort().flatMap((key) => compareValues(left[key], right[key], `${path}.${key}`));
  }
  return [{ path, active: left ?? null, draft: right ?? null }];
}

function countConfiguration(configuration) {
  return {
    components: configuration.component_groups.reduce((count, group) => count + group.options.length, 0),
    groups: configuration.component_groups.length,
    presets: configuration.presets.length,
    rules: configuration.compatibility_rules.length,
  };
}

function toBundleSummary(definition, revisions) {
  const active = revisions.find((revision) => revision.revision_id === definition.active_revision_id) ?? null;
  const draft = revisions
    .filter((revision) => revision.status === "draft")
    .sort((left, right) => right.revision_number - left.revision_number)[0] ?? null;
  return {
    bundle_definition_id: definition.bundle_definition_id,
    slug: definition.slug,
    parent_binding: structuredClone(definition.parent_binding),
    active_revision_id: definition.active_revision_id,
    active_revision_number: active?.revision_number ?? null,
    draft_revision_id: draft?.revision_id ?? null,
    draft_revision_number: draft?.revision_number ?? null,
    revision_count: revisions.length,
    updated_at: definition.updated_at,
  };
}

function toBundleDetail(definition, revisions) {
  return {
    definition: structuredClone(definition),
    revisions: revisions
      .sort((left, right) => right.revision_number - left.revision_number)
      .map((revision) => revision.status === "draft" ? toRevisionDetail(revision) : toRevisionSummary(revision)),
  };
}

function toRevisionSummary(revision) {
  return {
    revision_id: revision.revision_id,
    bundle_definition_id: revision.bundle_definition_id,
    revision_number: revision.revision_number,
    status: revision.status,
    created_at: revision.created_at,
    updated_at: revision.updated_at,
    created_by: revision.created_by,
    runtime_snapshot_ref: revision.runtime_snapshot_ref ? structuredClone(revision.runtime_snapshot_ref) : null,
  };
}

function toPublicationSummary(record) {
  const attempt = record?.publication_attempt;
  if (!attempt || typeof attempt.publication_id !== "string" || typeof attempt.revision_id !== "string") {
    throw new BundleAdminApplicationError("PERSISTENCE_FAILED", "publication audit record is malformed");
  }
  const result = record?.result ?? {};
  return {
    publication_id: attempt.publication_id,
    revision_id: attempt.revision_id,
    revision_number: attempt.revision_number,
    state: attempt.state,
    created_at: attempt.created_at,
    updated_at: attempt.updated_at,
    success: result.success === true,
    completed_steps: Array.isArray(result.completed_steps) ? structuredClone(result.completed_steps) : [],
    failed_step: result.failed_step ?? null,
    compensation: result.compensation ? structuredClone(result.compensation) : null,
    previous_active_revision_id: result.previous_active_revision_id ?? attempt.previous_active_revision_id ?? null,
    active_revision_id: result.active_revision_id ?? null,
    snapshot_checksum: result.snapshot_checksum ?? attempt.runtime_snapshot_ref?.checksum ?? null,
    warnings: Array.isArray(result.warnings) ? structuredClone(result.warnings) : [],
  };
}

function toRevisionDetail(revision) {
  return { ...toRevisionSummary(revision), configuration: structuredClone(revision.configuration) };
}

function assertNoBundleInstanceId(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoBundleInstanceId(item, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "_bundle_id" || key === "bundle_id") {
      throw new BundleAdminApplicationError("VALIDATION_FAILED", `${path}.${key} is reserved for per-cart bundle instances`);
    }
    assertNoBundleInstanceId(nested, `${path}.${key}`);
  }
}

function normalizeApplicationError(error, fallbackCode = "VALIDATION_FAILED") {
  if (error instanceof BundleAdminApplicationError) return error;
  if (error instanceof BundlePersistenceError) {
    if (error.code === "NOT_FOUND") {
      return new BundleAdminApplicationError("NOT_FOUND", error.message, error.details);
    }
    if (["VERSION_CONFLICT", "POINTER_DRIFT", "CHECKSUM_MISMATCH", "RETRY_CONFLICT"].includes(error.code)) {
      return new BundleAdminApplicationError("CONFLICT", error.message, error.details);
    }
    return new BundleAdminApplicationError("PERSISTENCE_FAILED", error.message, error.details);
  }
  const normalized = normalizeBundlePersistenceError(error, fallbackCode);
  return new BundleAdminApplicationError(
    BUNDLE_ADMIN_ERROR_CODES.includes(normalized.code) ? normalized.code : fallbackCode,
    normalized.message,
    normalized.details,
  );
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
