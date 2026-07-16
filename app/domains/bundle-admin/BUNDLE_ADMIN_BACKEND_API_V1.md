# Bundle Admin Backend API V1

This application layer has authenticated Remix resource routes consumed by the embedded Bundle Admin UI. Route handlers remain thin and delegate all domain behavior to this service layer.

## Dependencies

`createBundleAdminService` receives a Persistence Adapter, a query repository, a publication-service function, compiler and size-guard functions, a clock, and an ID factory. Authenticated routes compose it with the development-only Shopify adapter and the authenticated Admin GraphQL session. Unit tests use `createInMemoryBundlePersistenceAdapter` plus `createInMemoryBundleAdminRepository` through the explicit local composition. This app-domain layer imports shared pure modules from `extensions/master-kit-expand/src/config`; no Cart Transform entry imports this directory.

## Service DTOs

| Service | Input | Result |
| --- | --- | --- |
| `listBundles()` | none | `BundleSummary[]` |
| `getBundleDetail()` | `bundle_definition_id` | `BundleDetail` |
| `createBundleDefinition()` | stable ID, slug, parent binding, actor | `BundleDetail` |
| `updateBundleDefinition()` | stable ID, slug, parent binding, actor | `BundleDetail` |
| `createDraftRevision()` | definition ID, editable configuration, actor, optional revision ID | `RevisionDetail` |
| `cloneActiveRevisionToDraft()` | definition ID, actor, optional revision ID | `RevisionDetail` |
| `updateDraftRevision()` | revision ID, editable configuration, actor | `RevisionDetail` |
| `listRevisionHistory()` | definition ID | `RevisionSummary[]`, descending version |
| `listPublicationHistory()` | definition ID | immutable publication-attempt summaries, descending update time |
| `validateDraft()` | draft revision ID | validation DTO |
| `compilePreview()` | draft revision ID | validation, size, checksum, counts, active diff |
| `compareDraftAgainstActive()` | draft revision ID | exact flag and structural differences |
| `prepareDraftPublication()` | draft revision ID | read-only local preflight; no publication writes |
| `publishDraftRevision()` | draft revision ID, publication ID, exact confirmation | guarded dev-only command; disabled unless server composition is explicitly enabled |
| `prepareRevisionRollback()` | superseded revision ID | read-only rollback preflight; recompiles the immutable revision configuration without writes |
| `rollbackPublishedRevision()` | superseded revision ID, publication ID, exact confirmation | guarded dev-only rollback command; disabled unless server composition is explicitly enabled |

`BundleSummary` contains definition identity, parent binding, active and latest-draft revision pointers/numbers, revision count, and update time. `BundleDetail` exposes full configuration only for draft revisions so the editor can save through the draft-only command; immutable revision history remains summary-only. `listPublicationHistory()` exposes only audit summaries: publication/revision IDs, state, timestamps, result steps, compensation status, pointer IDs, checksum, and warnings. It never returns persisted domain configuration or editable Runtime Snapshot content.

## Errors

Services throw `BundleAdminApplicationError`, which can be serialized by `toApplicationErrorDto`:

```json
{ "code": "NOT_FOUND", "message": "BundleRevision was not found", "details": null }
```

Supported codes: `NOT_FOUND`, `CONFLICT`, `VALIDATION_FAILED`, `IMMUTABLE_REVISION`, `COMPILATION_FAILED`, `PERSISTENCE_FAILED`, and `UNSUPPORTED_CAPABILITY`.

## Edit and Preview Rules

- `bundle_definition_id` is service-controlled and stable.
- A definition's parent product/variant binding may be corrected only before its first revision exists. Once any revision exists, the binding is immutable so revision configuration, Snapshot storage ownership, and the active pointer cannot diverge. Create a new BundleDefinition for a different parent variant.
- `_bundle_id` and `bundle_id` are rejected anywhere in editable persistence input.
- Only `draft` revisions can be updated, validated, compiled, or compared.
- The service sets configuration ID, version, status, and revision fields. A caller cannot promote or assign a Runtime Snapshot.
- Preview validates the revision first, then compiles the existing Runtime Snapshot V1 and applies the accepted 7000/7500/9000-byte gate. It returns checksum, byte size, configuration version, component/group/preset/rule counts, warnings/errors, and a complete structural diff against the active revision.
- `prepareDraftPublication()` only aggregates the existing validation, compile/size, and active-diff evidence. It never calls the injected Publication Service, changes a revision, writes a Snapshot, or switches `active_revision_id`. Its `local_preflight_passed` result is deliberately not a publish authorization: real Function promotion parity and explicit publish authorization remain required.
- `prepareRevisionRollback()` accepts only a `superseded` revision with a currently `published` active revision. It recompiles the immutable target configuration and applies the same validation and Snapshot-size gate, but it never writes Snapshot data, a pointer, a Revision, or an audit record.
- `rollbackPublishedRevision()` requires the same server-side controls and evidence binding as publication, plus `ROLLBACK:<bundle_definition_id>:<revision_id>` confirmation. It is disabled by default and exists only for local integration coverage until separately approved.
- `publishDraftRevision()` has a fail-closed default. It requires `BUNDLE_ADMIN_PUBLICATION_ENABLED=true`, a non-empty `BUNDLE_ADMIN_PROMOTION_EVIDENCE_DIRECTORY`, an injected persistence driver, server-side fixture-based promotion evidence bound to the exact `bundle_definition_id`, `revision_id`, and compiled Snapshot checksum, a caller-supplied stable `publication_id`, and `PUBLISH:<bundle_definition_id>:<revision_id>` confirmation. Bare candidate/hard-coded result payloads are rejected. Without both server settings, the authenticated route returns `422 UNSUPPORTED_CAPABILITY` and no Shopify write is attempted.
- The server-side evidence provider accepts only a deterministic artifact file named `<bundle_definition_id>.<revision_id>.<snapshot_checksum>.json`, produced by the offline parity generator. The provider validates the artifact again before returning it to the command. It is not configured in the current Shopify or local default composition, so Publish remains disabled even when an artifact exists.
- The guarded publish resource route is present for local integration coverage, but the current server composition has neither required environment control configured; it is therefore disabled by default and returns `422 UNSUPPORTED_CAPABILITY` before any Shopify write. Enabling it or exposing its UI is a separate explicitly approved release and live-validation phase.

## Structured Draft Editing

The embedded Draft editor keeps the complete Bundle Config V1 JSON document as the advanced editing entry point. It also provides controlled local editing fields for existing component groups, options, presets, and compatibility rules. These fields update only the in-browser draft document; no Shopify request is made until the existing `Save draft` command is selected.

- Structured controls do not expose Runtime Snapshot data and cannot publish a revision.
- They preserve unrecognized compatible fields when applying a targeted edit, so a newer optional configuration field is not removed by an older Admin UI.
- Stable entity identities (`group_key`, `option_key`, `preset_id`, and `rule_id`) are intentionally read-only in the controlled layer because they can be referenced by groups, presets, and rules. Advanced, cross-reference-aware changes remain available through the JSON editor and are validated by the existing draft validation command.
- The controlled layer supports common fields only: group label/order/selection limits/required state; option label/order/price snapshot/active state; preset label/order/active/compatibility state; and rule priority/status/effect/match. It does not create or delete entities in this MVP.

## Authenticated Resource Routes

Every route calls the existing Shopify embedded-app `authenticate.admin(request)` flow, then composes a service with that session's Admin GraphQL client and the guarded development-only Shopify adapter. It uses only the existing `$app:aces_*_dev` Metaobject types and `aces_dev` product metafield keys. The local in-memory composition is not used by routes. Routes return `Cache-Control: no-store` JSON, and there is no publish endpoint.

| Method | Path | Service |
| --- | --- | --- |
| `GET` | `/app/bundle-admin/bundles` | `listBundles` |
| `POST` | `/app/bundle-admin/bundles` | `createBundleDefinition` |
| `GET` | `/app/bundle-admin/bundles/:bundleDefinitionId` | `getBundleDetail` |
| `PUT` | `/app/bundle-admin/bundles/:bundleDefinitionId` | `updateBundleDefinition` |
| `POST` | `/app/bundle-admin/bundles/:bundleDefinitionId/draft-revisions` | `createDraftRevision` |
| `POST` | `/app/bundle-admin/bundles/:bundleDefinitionId/clone-active` | `cloneActiveRevisionToDraft` |
| `GET` | `/app/bundle-admin/bundles/:bundleDefinitionId/revisions` | `listRevisionHistory` |
| `GET` | `/app/bundle-admin/bundles/:bundleDefinitionId/publications` | `listPublicationHistory` (read-only audit summaries) |
| `PUT` | `/app/bundle-admin/revisions/:revisionId` | `updateDraftRevision` |
| `POST` | `/app/bundle-admin/revisions/:revisionId/validate` | `validateDraft` |
| `POST` | `/app/bundle-admin/revisions/:revisionId/compile-preview` | `compilePreview` |
| `POST` | `/app/bundle-admin/revisions/:revisionId/publish-readiness` | `prepareDraftPublication` |
| `POST` | `/app/bundle-admin/revisions/:revisionId/publish` | `publishDraftRevision` (explicitly disabled by default) |
| `POST` | `/app/bundle-admin/revisions/:revisionId/rollback-readiness` | `prepareRevisionRollback` |
| `POST` | `/app/bundle-admin/revisions/:revisionId/rollback` | `rollbackPublishedRevision` (explicitly disabled by default) |
| `POST` | `/app/bundle-admin/revisions/:revisionId/compare-active` | `compareDraftAgainstActive` |

Success uses `{ "ok": true, "data": ... }`. Failures use `{ "ok": false, "error": { "code", "message", "details" } }`. Status mapping is `400` malformed input, `401`/`403` authentication failure, `404` not found, `409` conflict or immutable revision, `422` validation or compilation failure, and `500` unexpected server error.
