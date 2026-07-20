# Project Master Context V5.4 - Current Engineering Baseline

Project: ACES Shopify SKU Expansion / EFI Product Builder
Status date: 2026-07-16
Supersedes: V5.3 as the current SSOT. V5.2 remains an immutable historical baseline.

## 1. Verified baseline

POC-01 through POC-06 and the Option C architecture remain locked:

- Cart has one Master Kit parent line per bundle instance.
- Checkout and Orders expand into components; inventory deducts components only.
- `lineUpdate` and runtime `productVariantComponents` are prohibited.
- Bundle Metadata V1 and dedicated Builder-template isolation remain mandatory.

The active workstream is the Bundle Admin Editor and development-only persistence path. No production runtime authority change is approved.

## 2. Runtime authority

### Production Function

- Authority is the hard-coded Shared Core result in `extensions/master-kit-expand/src/run.core.js`.
- Production entry/query contain no Snapshot, candidate, shadow, or `aces_dev` tokens.
- Production-clean assertion is required before every approved Function deployment.

### Development Function

- Runtime Snapshot V1 extraction, validation, resolution, comparison, and candidate gates are implemented.
- Size limits: target `<= 7000` bytes; warning `> 7500`; reject `> 9000`.
- Candidate authority requires Snapshot presence, parse/validation/resolution success, exact parity, no unsupported fields, and no differences. All failures return Shared Core.
- The current deployed Function profile/version must be independently confirmed before any Function work. No Function change was made in the current Bundle Admin batch.

## 3. Bundle domain and persistence

- `bundle_definition_id` is the stable definition UUID.
- `_bundle_id` is exclusively the per-cart instance UUID. Legacy `bundle_id` and `_bundle_id` are rejected from editable persistence input.
- `active_revision_id` is the only active pointer on BundleDefinition.
- Revision states are `draft`, `published`, `superseded`, and `archived`; only drafts are editable.
- Parent product/variant binding becomes immutable after the first revision.

Development-only Shopify resources:

| Concern | Resource |
| --- | --- |
| BundleDefinition | `$app:aces_bundle_definition_dev` Metaobject |
| BundleRevision | `$app:aces_bundle_revision_dev` Metaobject |
| PublicationRecord | `$app:aces_bundle_publication_record_dev` Metaobject |
| Runtime Snapshot | `aces_dev.bundle_runtime_snapshot_v1` product metafield |
| Active pointer | `aces_dev.active_revision_id_v1` product metafield |

The development adapter is restricted to `cart-transform-poc-dev`, supports metafield `compareDigest` CAS, read-back verification, pagination, normalized errors, and publication idempotency. It never targets production keys or the Custom Distribution App.

## 4. Bundle Admin application

Authenticated Remix routes use embedded Shopify Admin authentication, no-store JSON envelopes, and the development-only Shopify adapter. Route handlers stay thin; domain logic remains in `app/domains/bundle-admin/`.

Implemented Admin capabilities:

- Bundle list/detail and revision history.
- Create, clone, update, validate, compile-preview, and compare draft revisions.
- Durable Metaobject create/update verification: a mutation result is not reported as saved until a read-back confirms the expected persisted document.
- Refresh feedback and persisted-draft confirmation.
- Read-only publication audit history.
- Local publication and rollback preflight.
- Guarded publication/rollback resource routes exist for local integration coverage but are fail-closed. They require both server-side environment opt-in and server-owned promotion evidence. Neither control is configured in the default composition; the routes return `422 UNSUPPORTED_CAPABILITY` before any Shopify write.

Publishing Runtime Snapshot authority is not an enabled Admin workflow. The UI does not expose a publish action under the default composition.

## 5. Bundle Config V1 editing

The embedded Bundle Admin Draft editor has two compatible editing paths:

1. Complete JSON editor: the advanced entry point for the entire Bundle Config V1 document.
2. Controlled editor: local fields for existing Groups, Options, Presets, Compatibility Rules, preset selections and locks, rule targets, existing rule conditions, rule option-constraint arrays, fallback, message, and visibility fields. It can remove only unreferenced Groups/Options, remove Presets/Rules, create Presets as inactive or Rules as draft from active default selections, and clone Presets as inactive or Rules as draft.

The controlled editor changes only browser draft state. `Save draft` remains the sole operation that sends the revision document to the server. Unknown compatible fields are preserved during a focused structured edit.

Stable IDs (`group_key`, `option_key`, `preset_id`, `rule_id`) are intentionally not editable through controlled fields. New Preset/Rule IDs are generated locally and must still pass normal draft validation before persistence. Before a Group or Option can be deleted, the editor scans preset selections/locks, group defaults, rule targets, conditions, option constraints, and fallbacks; it refuses deletion rather than silently rewriting references. Creation of Groups/Options and uncommon advanced fields remain JSON-editor changes followed by existing validation. Runtime Snapshot data is not directly editable.

## 6. Current verification evidence

- Commit `848ec35` was pushed to `origin/main`.
- Devbox pulled the commit, built the Remix application, and Sealos started a new app-server Pod successfully.
- The initial Pod delay was image pull time (approximately 3m24s); Remix subsequently listened on port 3000.
- Huang confirmed the real embedded Admin page displays the structured Groups, Options, Presets, and Compatibility Rules controls.
- Huang reported the controlled draft save/refresh persistence test passed.
- The local controlled-editor completion batch added reference-safe removal, inactive Preset creation, draft Compatibility Rule creation, inactive/draft cloning, and protected stable IDs. Group/Option creation remains an advanced JSON workflow because a safe visual workflow would require verified product/Variant binding.
- Publication and rollback remain fail-closed when either server-side gate is absent: setting only the server opt-in or only the promotion-evidence directory cannot reach a Shopify metafield write.
- The app-server local hardening batch added unauthenticated `GET /healthz` readiness coverage and documented the Devbox startup boundary.
- The publication service now preflights external active-pointer drift before any Snapshot write and rechecks it before pointer CAS. This prevents a stale Definition pointer from silently writing a candidate Snapshot.
- A local-only dev publication rehearsal planner now generates compiled Snapshot/parity evidence and an isolated operation plan. It has no Shopify CLI integration or apply mode, and rejects the existing live dev and historical test metafield keys.
- A local-only production persistence readiness checker now rejects incomplete approval, validation, resource-isolation, recovery, parity, authority, or Custom Distribution App evidence before an external phase can begin. It has no Shopify transport or write path.
- On 2026-07-17, the first explicitly approved dev-store publication rehearsal reached only a partial isolated state before Shopify CLI lost its Admin API socket. It created the isolated rehearsal BundleDefinition and draft baseline revision, then wrote only `aces_dev.bundle_runtime_snapshot_publication_rehearsal_v1` (checksum `23143031`) and `aces_dev.active_revision_id_publication_rehearsal_v1` (baseline revision ID). The subsequent domain lifecycle read failed with `socket hang up` against `https://huang-mvqquz1p.myshopify.com/admin/api/2026-04/graphql.json`. Read-only reconciliation confirmed no candidate revision, no publication audit record, and no rollback record. The primary dev Snapshot/pointer keys, legacy test key, Cart Transform, and production resources were not touched. Do not rerun or compensate this partial rehearsal until a separately reviewed recovery operation can safely reconcile the isolated pointer and Metaobject domain state.
- The isolated rehearsal recovery subsequently completed through evidence-bound, resumable steps: the baseline Revision is `published`, the isolated Definition points to it, and the baseline PublicationRecord exists. The isolated Snapshot remains checksum `23143031`; its compareDigest is `c3e2baad41a37563ac4a9968600fa1998f941e4e66b597d6ef401b9c6c7e13be`. The isolated pointer still targets the baseline revision; its compareDigest is `607f08ec5e636eed01d9370eaf09f0e94fc0dc30f810eefec803f3dfe37e74b5`. Candidate and rollback records remain absent. Shopify CLI transport remains intermittently unstable, so the remaining candidate, idempotency, stale-CAS, and rollback steps must be resumable and separately read back; do not use the former all-in-one execution path.
- Current local verification passed: `npm test` (316 tests), `npm run test:function` (232 tests), focused production-readiness tests (6 tests), `npm run lint`, `npm run build`, `npm run validate:local`, `npm run assert:function:production-clean`, and `git diff --check`.

Any new live result must be recorded separately; local results do not prove future deployment state.

## 7. Environment and release workflow

- Development app: `cart-transform-poc-dev`.
- Development store: `huang-mvqquz1p.myshopify.com`.
- Development config: `shopify.app.dev.toml`.
- Local preview config: `shopify.app.local.toml`; do not commit.
- Custom Distribution App: `cart-transform-poc`; out of scope without explicit approval.
- Admin API baseline: `2026-04`.

The Sealos application starts with `npm run docker-start`, which builds Remix, runs Prisma setup, and then starts the server. A GitHub-based release only requires Devbox to pull the approved commit before publishing a new version; the startup command prevents a stale `build/` directory from serving old source. A new Pod can spend several minutes pulling a cold image; wait for `Pulled` and then `Started` before troubleshooting application logs.

- `GET /healthz` is an unauthenticated, no-store readiness probe returning only
  `{ "ok": true, "service": "cart-transform-poc" }`. It does not access a
  Shopify session, Admin API, persistence resource, or Runtime Snapshot.

## 8. Formal Git baseline

| Commit | Scope |
| --- | --- |
| `c0837d5` | Shared Core, Function profiles, Runtime Snapshot V1, gates, tests, tooling |
| `65cf71b` | Domain contracts, publication service, persistence adapter, dev Shopify adapter |
| `91b72e1` | Authenticated Bundle Admin backend and routes |
| `6884790` | Bundle Admin Polaris UI MVP |
| `1ad12a9` | Runtime boundary hardening and parent-binding immutability |
| `19e2522` | Durable Metaobject update verification and safe persistence error mapping |
| `67339e7` | Guarded Bundle Admin publication readiness |
| `848ec35` | Durable persistence, audit, structured Bundle Config V1 editor |

## 9. Required local validation

Run after code changes:

    npm test
    npm run test:function
    npm run lint
    npm run build
    npm run validate:local
    npm run assert:function:production-clean
    git diff --check

Do not deploy, commit, push, seed, or modify Shopify data without explicit approval.

## 10. Next work in order

### Completed local-only batch

1. Controlled creation ergonomics are complete where reference safety can be proven locally: Presets start inactive and Rules start as drafts. Group/Option creation remains in the JSON editor until a verified product/Variant binding workflow is approved.
2. The default-disabled publication/rollback surface has been reviewed and has focused tests for incomplete server-side gate combinations.
3. App-server startup documentation and a no-store readiness endpoint are in place. Neither changes the locked Function path.
4. Publication preflight now fails before a Snapshot write when external active-pointer drift is detected. A local-only rehearsal planner prepares isolated development-store evidence without any Shopify mutation.
5. Production rollout readiness is now represented by a local-only evidence checker and V5.5 proposal. It does not authorize or perform production operations.

### Explicitly approved future phases

1. Resolve the 2026-07-17 isolated development rehearsal incident with a reviewed, evidence-bound recovery operation; then verify guarded publication, compensation, and rollback against only development Shopify resources, including Snapshot and active-pointer read-back/CAS evidence.
2. Validate the accumulated Bundle Admin batch through a real embedded development-store session after an explicitly approved release.
3. Design and approve the production persistence rollout: resource definitions, access controls, migration, observability, rollback ownership, and operational runbook.
4. Consider production Runtime Snapshot authority only after publication, audit, compensation, and Browser -> Cart -> Checkout regression gates are accepted.

## 11. Non-negotiable rules

- Preserve Option C, Builder, Cart, Checkout, Orders, and inventory behavior.
- Never add environment behavior to `run.core.js`.
- Do not use `lineUpdate` or runtime `productVariantComponents`.
- Do not expose Runtime Snapshot as editable Admin UI data.
- Do not touch the Custom Distribution App without explicit approval.
- Debug with evidence: persisted read-back before claiming save success, `/cart.js` before Checkout, and active Function profile/version before Function recovery.
