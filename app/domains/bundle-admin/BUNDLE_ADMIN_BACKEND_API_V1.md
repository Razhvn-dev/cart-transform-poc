# Bundle Admin Backend API V1

This local application layer has authenticated headless Remix resource routes. React UI remains intentionally out of scope.

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
| `validateDraft()` | draft revision ID | validation DTO |
| `compilePreview()` | draft revision ID | validation, size, checksum, counts, active diff |
| `compareDraftAgainstActive()` | draft revision ID | exact flag and structural differences |

`BundleSummary` contains definition identity, parent binding, active and latest-draft revision pointers/numbers, revision count, and update time. `BundleDetail` exposes full configuration only for draft revisions so the editor can save through the draft-only command; immutable revision history remains summary-only. Runtime Snapshot content is never an input or returned as editable data; only immutable `runtime_snapshot_ref` metadata appears on published-history DTOs.

## Errors

Services throw `BundleAdminApplicationError`, which can be serialized by `toApplicationErrorDto`:

```json
{ "code": "NOT_FOUND", "message": "BundleRevision was not found", "details": null }
```

Supported codes: `NOT_FOUND`, `CONFLICT`, `VALIDATION_FAILED`, `IMMUTABLE_REVISION`, `COMPILATION_FAILED`, `PERSISTENCE_FAILED`, and `UNSUPPORTED_CAPABILITY`.

## Edit and Preview Rules

- `bundle_definition_id` is service-controlled and stable.
- `_bundle_id` and `bundle_id` are rejected anywhere in editable persistence input.
- Only `draft` revisions can be updated, validated, compiled, or compared.
- The service sets configuration ID, version, status, and revision fields. A caller cannot promote or assign a Runtime Snapshot.
- Preview validates the revision first, then compiles the existing Runtime Snapshot V1 and applies the accepted 7000/7500/9000-byte gate. It returns checksum, byte size, configuration version, component/group/preset/rule counts, warnings/errors, and a complete structural diff against the active revision.
- Publishing remains out of scope. The injected Publication Service is reserved for the later explicit publish application command.

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
| `PUT` | `/app/bundle-admin/revisions/:revisionId` | `updateDraftRevision` |
| `POST` | `/app/bundle-admin/revisions/:revisionId/validate` | `validateDraft` |
| `POST` | `/app/bundle-admin/revisions/:revisionId/compile-preview` | `compilePreview` |
| `POST` | `/app/bundle-admin/revisions/:revisionId/compare-active` | `compareDraftAgainstActive` |

Success uses `{ "ok": true, "data": ... }`. Failures use `{ "ok": false, "error": { "code", "message", "details" } }`. Status mapping is `400` malformed input, `401`/`403` authentication failure, `404` not found, `409` conflict or immutable revision, `422` validation or compilation failure, and `500` unexpected server error.
