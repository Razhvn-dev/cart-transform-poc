# Project Master Context V5.3 - Current Engineering Baseline

Project: ACES Shopify SKU Expansion / EFI Product Builder
Status date: 2026-07-16
Supersedes: V5.2 as the current SSOT. V5.2 remains an immutable historical baseline.

## 1. Evidence and status

This document separates code/test facts, last verified remote behavior, and unverified work. Current code and tests are authoritative for local behavior. Any deployed Shopify or Sealos state must be rechecked before a new deployment.

POC-01 through POC-06 remain accepted. The Option C architecture remains locked:

- Cart contains one Master Kit parent line.
- Checkout and Orders expand into component lines.
- Inventory deducts components only.
- `lineUpdate` and runtime `productVariantComponents` are prohibited.
- Bundle Metadata V1 and dedicated Builder template isolation are mandatory.

The active workstream is the Bundle Admin Editor and its development-only persistence path. Publishing a configuration to runtime authority is not exposed in the Admin UI.

## 2. Runtime architecture

### Production Function

- Authority remains the hard-coded Shared Core result in `extensions/master-kit-expand/src/run.core.js`.
- Production entry/query contain no Snapshot, candidate, shadow, or `aces_dev` tokens.
- Production-clean assertion is required before every approved Function deployment.

### Development Function

- Runtime Snapshot V1 extraction, parse, validation, resolution, comparison, promotion gates, and candidate result construction are implemented.
- Snapshot size policy: target `<= 7000` bytes; warning `> 7500`; hard rejection `> 9000`.
- Candidate output is allowed only when all gates pass: Snapshot exists, parses, validates, resolves, has exact operation parity, has no unsupported fields, and has no differences. All other paths return Shared Core.
- The hosted Stage 2-8 bisect found a heavy comparator dependency graph. It was refactored to a lightweight comparator; the optimized Stage 7 and Stage 8 candidate path were last reported as passing in the development store.
- The exact active Function version must be confirmed before a future Function change. Local code and historic reports are not proof of a current deployed version.

## 3. Bundle domain contracts

- `bundle_definition_id` is the stable BundleDefinition UUID.
- `_bundle_id` is exclusively the per-cart bundle-instance UUID.
- `_bundle_id` and legacy `bundle_id` are rejected from editable persistence input.
- `active_revision_id` belongs to BundleDefinition and is the only active pointer.
- Domain records: BundleDefinition, BundleRevision, and PublicationRecord/publication attempt.
- Revision states: `draft`, `published`, `superseded`, `archived`.
- Only drafts are editable; all other revisions are immutable.
- Updating a published configuration requires a new draft.
- Parent product/variant binding can be corrected only before the first revision. A different binding requires a new definition.

## 4. Publication and persistence

The local staged publication service is implemented and tested. Its intended stages are normalize/validate, compile Snapshot, apply checksum/size/promotion gates, write and read back Snapshot, CAS active pointer, supersede prior revision, and record the publication attempt. It supports retry, rollback, drift detection, failure handling, and compensation. It is not yet exposed as an HTTP publish command.

Development-only Shopify resources:

| Concern | Resource |
| --- | --- |
| BundleDefinition | `$app:aces_bundle_definition_dev` Metaobject |
| BundleRevision | `$app:aces_bundle_revision_dev` Metaobject |
| PublicationRecord | `$app:aces_bundle_publication_record_dev` Metaobject |
| Runtime Snapshot | `aces_dev.bundle_runtime_snapshot_v1` product metafield |
| Active pointer | `aces_dev.active_revision_id_v1` product metafield |

The adapter is guarded to `cart-transform-poc-dev`, maps normalized errors, supports product metafield `compareDigest` CAS, read-back verification, publication idempotency, and pagination. It does not target production keys or the Custom Distribution App.

Phase 4.4D was recorded as passing real dev-store resource and stale-CAS validation. No production Metaobject or metafield resources were created.

## 5. Bundle Admin application

Implemented server application layer in `app/domains/bundle-admin/`:

- list/get/create/update BundleDefinitions;
- create/clone/update draft revisions;
- revision history;
- draft validation;
- compile preview;
- draft-versus-active comparison.

Routes use embedded Shopify Admin authentication, no-store JSON envelopes, and normalized status mapping: `400`, `401/403`, `404`, `409`, `422`, and `500`. Route handlers remain thin; domain logic stays in the application layer. The local in-memory composition remains available only for unit tests; authenticated routes compose the dev Shopify adapter with the session Admin GraphQL client.

The Polaris embedded MVP provides a list, detail, revision history, draft JSON editor, save, validate, compile preview, and active diff. No publish button or editable Runtime Snapshot data exists. Parent binding is locked after a first revision.

## 6. Known persistence issue

In real Admin UI validation, a draft edit previously returned a success message but disappeared after a browser hard reload. Refresh only reloads the detail resource; it does not persist browser text. Therefore old data after Refresh is persistence evidence, not a Refresh-control feature.

Commit `19e2522` added mutation-response plus immediate read-back verification for Metaobject updates and returns `PERSISTENCE_FAILED` rather than a false success. Current local, uncommitted work extends the same durable-confirmation invariant to Metaobject creates and tests the full service path where a mutation response succeeds but read-back returns the old document. This has passed local validation, but needs an explicitly approved future Sealos/Shopify release before it can be considered a live fix.

## 7. Environment and deployment boundaries

- Authorized development app: `cart-transform-poc-dev`.
- Development store: `huang-mvqquz1p.myshopify.com`.
- Development configuration: `shopify.app.dev.toml`.
- Local preview configuration: `shopify.app.local.toml`; never commit it.
- Custom Distribution App: `cart-transform-poc`; out of scope without explicit approval.
- Admin API baseline: `2026-04`.
- Development scopes include `read_metaobjects` and `write_metaobjects` after reauthorization.
- Sealos releases require GitHub pull, a newly built container image, then an application update. Restarting an old workload cannot add new source to its existing image.
- Shopify app/extension deployment is separate from an app-server container release.

## 8. Formal Git baseline

| Commit | Scope |
| --- | --- |
| `c0837d5` | Shared Core, Function profiles, Runtime Snapshot V1, gates, tests, tooling |
| `65cf71b` | Domain contracts, publication service, persistence adapter, dev Shopify adapter |
| `91b72e1` | Authenticated Bundle Admin backend and routes |
| `6884790` | Bundle Admin Polaris UI MVP |
| `1ad12a9` | Runtime boundary hardening and parent-binding immutability |
| `19e2522` | Durable Metaobject update verification and safe persistence error mapping |

At this update, the source/test changes for durable create/update confirmation and Refresh confirmation are uncommitted. Two old Phase 4.4D GraphQL probe files under `scripts/` are retained locally but ignored: one contains an intentional stale-CAS mutation and neither belongs in a future code commit.

## 9. Required local validation

Run relevant commands after code changes:

    npm test
    npm run lint
    npm run build
    npm run test:function
    npm run validate:local
    npm run assert:function:production-clean
    git diff --check

The latest local validation completed successfully after the current persistence-confirmation changes. No Shopify, Sealos, Git commit, or Git push action was run for this local batch.

## 10. Next work in order

### Immediate local-only batch

1. Finish Bundle Admin draft-persistence diagnosis and UX handling without Shopify writes or Sealos release.
2. Add clear Refresh loading/result feedback and ensure a failed durable read-back can never surface as a success state.
3. Extend route-to-service integration coverage for persistence failures, stale reads, and conflicts.
4. Review all uncommitted source, documentation, and temporary probe files; retain only durable materials for the next batch.

### Next approved release and validation

1. Commit and push the reviewed local batch only after Huang explicitly approves release.
2. Pull the exact commit in Devbox, build a new image, and release it through Sealos.
3. Verify embedded Admin: draft edit, save, Refresh, hard reload, invalid JSON, immutable revision, validation failure, and conflict response.
4. If read-back fails, retain evidence and do not make speculative Shopify schema changes.

### Later work, not started

1. Add an explicit guarded publish command using the staged publication service.
2. Validate compensation/rollback against dev-only Shopify resources.
3. Design a production persistence rollout separately from dev resources.
4. Consider production Runtime Snapshot authority only after publish flow, audit trail, and regression gates are accepted.

## 11. Non-negotiable rules

- Preserve accepted Option C, Builder, Cart, Checkout, Orders, and inventory behavior.
- Never add environment behavior to `run.core.js`.
- Do not use `lineUpdate` or runtime `productVariantComponents`.
- Do not expose Runtime Snapshot as editable Admin UI data.
- Do not deploy, commit, push, seed, or modify Shopify data without explicit approval.
- Do not touch the Custom Distribution App without explicit approval.
- Debug with evidence: `/cart.js` before Checkout, active Function profile/version before Function recovery, and persisted read-back before claiming a write succeeded.
