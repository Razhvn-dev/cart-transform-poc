# Pre-built Bundle Checkout Expansion Handoff - 2026-07-20

## Current status

**The visible Cart-to-Checkout behavior passed through version 38. The optimized dynamic
candidate in version 39 failed hosted acceptance and was immediately removed. Development
version `cart-transform-poc-dev-40` restores the last known-good Checkout expansion.**

Versions 33 through 35 proved the static expand payload, the full pre-built GraphQL query,
and `extractPrebuiltBundleRuntimeFunctionInput` in Shopify's hosted runtime. Version 36
executes the complete `buildPrebuiltBundleRuntimeFunctionCandidate(input)` path before
returning the already-proven static expand. Production runtime authority remains unchanged.

This is not the legacy Builder price path. `$750.48` belongs only to the legacy Master
Kit Builder test. The approved pre-built test SKU is `$100.00`; its expected Checkout
total is also `$100.00`, allocated across its resolved components.

## Confirmed remote evidence

- Store: `huang-mvqquz1p.myshopify.com`.
- Development app: `cart-transform-poc-dev`.
- Tested product: `prebuilt-bundle-test`.
- Parent product GID: `gid://shopify/Product/10627515777302`.
- Parent variant GID: `gid://shopify/ProductVariant/51571819708694`.
- Cart evidence: one parent line at `$100.00`, with `_bundle_id`,
  `_bundle_schema_version: "1"`, `_parent_product_gid`, and
  `_parent_variant_gid` present in `/cart.js`.
- Current Checkout evidence: version 40 expands the `$100.00` parent into EFI,
  Fuel, and Ignition component lines while preserving the `$100.00` total.
- Server-owned inputs previously read back successfully:
  `aces_dev.prebuilt_bundle_runtime_mapping_v1` and
  `aces_dev.bundle_runtime_snapshot_v1`.
- Mapping Definition ID: `4b8d6e5a-6c68-4d78-8e5b-1a9b8e5f1001`.
- Revision ID: `4b8d6e5a-6c68-4d78-8e5b-1a9b8e5f1002`.
- Verified Snapshot checksum: `59b8abd0`.
- Read-only verification and Huang's subsequent manual acceptance confirmed
  `cart-transform-poc-dev-40` as the frozen known-good development baseline.
- The development store has exactly one Cart Transform registration,
  `gid://shopify/CartTransform/135266582`. Its Function ID
  `019f5e8c-0374-7577-b756-66af47a751be` exactly matches the only installed
  Shopify Function, `Master Kit Expand` with API type `cart_transform`.
- The Shopify CLI exposes `extensions.master-kit-expand` as the Function log
  source. No invocation arrived during a bounded passive log stream, so a new
  controlled Checkout attempt is still required to capture an invocation.

## What was verified locally

- The fixed-selection resolver produces the expected three-component projection:
  EFI `$50.00`, Fuel `$30.00`, Ignition `$20.00`; Display is omitted by the
  configured compatibility rule.
- The resulting component allocations total `$100.00`.
- Candidate promotion gates, Metadata V1 correlation checks, mapping/Snapshot
  binding, and unsupported-operation checks pass for the recorded test inputs.
- The candidate artifact was checked for `structuredClone`; no remaining
  `structuredClone` token was found after the runtime graph was reduced.
- Full local validation passed before version 28 deployment: app tests, Function
  tests, lint, build, `validate:local`, production-clean assertion, and
  `git diff --check`.
- After the local hardening in this batch, full validation passed again on
  2026-07-20: 64 test files / 454 tests, 45 Function test files / 335 tests,
  lint, app build, candidate and production Function builds, production-clean,
  and `git diff --check`.

## Local hardening after the hosted failure

- The dev-only candidate now rejects a Snapshot whose parent Product GID does not
  match the actual cart-line Product, even when the parent Variant matches.
- Candidate component lines now preserve Bundle Metadata V1. The bundle instance ID
  and schema version come from correlation metadata that passed cart-line validation;
  parent/component identity, SKU, title, role, sequence, and Variant attributes come
  from the checksum-valid server Snapshot.
- A representative regression now uses the actual `prebuilt-bundle-test` Product and
  Variant GIDs instead of relying only on the legacy Builder parent fixture.
- These safety fixes do not establish the cause of the hosted no-op. They are now included
  in active development version 30 but have not received a controlled Checkout invocation.
- A read-only development-store diagnostic now fetches the current mapping/Snapshot
  without printing or retaining their raw documents. The current live data passes every
  local input, metadata, resolution, promotion, and shape gate, producing one expand
  operation with the expected three Variant GIDs and total `$100.00`.
- A dev-only `prebuilt-static-probe` profile was prepared, locally built, and deployed only
  for the bounded version 29 diagnostic window. It uses the
  production-clean query and a minimal exact-parent expand with the observed three
  component GIDs at `$50/$30/$20`. It reads no mapping/Snapshot and is no longer active.
  A future controlled deployment plus one Checkout/log capture can distinguish a
  basic hosted binding/expand failure from a failure in the full candidate graph.

## Controlled probe deployment result

- `cart-transform-poc-dev-29` deployed the minimal static probe successfully and became
  active. Read-only verification again confirmed the single Cart Transform registration
  resolves to the single installed `Master Kit Expand` Function.
- A bounded three-minute Function log stream received no invocation because no controlled
  Checkout was triggered during the window. This is not evidence that the probe returned
  a no-op or failed; no hosted execution result was observed.
- Browser automation could not trigger Checkout because the selected Chrome profiles do
  not have the ChatGPT Chrome Extension installed. Do not substitute scripted storefront
  access for the authenticated browser evidence.
- Shopify CLI cannot reactivate an older version directly. The hardened candidate was
  therefore redeployed as `cart-transform-poc-dev-30` and is now active; the static probe
  version 29 is inactive. The local query, generated types, and Function artifact were
  restored to production-clean state afterward.
- The deployment also exposed an existing Theme Check asset-size error: the readable
  `product-builder.js` was 11,064 bytes against a 10,000-byte threshold. Its deployed asset
  is now minified to 6,396 bytes with lint disabled for the generated file; a subsequent
  full Shopify app build passed Theme Check.

## Manual Checkout evidence after version 30

- Huang supplied storefront Cart and Checkout screenshots after version 30 became active.
  Cart showed one `prebuilt-bundle-test` parent at `$100.00`; Checkout also showed one
  parent at `$100.00`, with no EFI, Fuel, or Ignition component lines. This confirms the
  hardened full candidate still produced no visible expansion for that Checkout.
- The Checkout occurred before the Function log stream started, and Shopify did not replay
  a historical invocation. A second minimal static-probe window was deployed as version 31,
  but no fresh invocation arrived during the bounded stream, so version 31 did not produce
  a valid pass/fail result.
- The candidate was restored as `cart-transform-poc-dev-32`; version 31 is inactive. A new
  probe result requires creating or entering Checkout from the Cart after the probe version
  becomes active, while the Function log stream is already connected.

## Successful synchronized static probe

- Version `cart-transform-poc-dev-33` ran the production-query static probe during a new
  Cart-to-Checkout transition. Huang's Checkout screenshot confirmed one parent bundle
  containing the expected EFI, Fuel, and Ignition component lines at a total of `$100.00`.
- This proves the active Cart Transform registration, hosted Function invocation, basic
  expand payload, component Variant IDs, and fixed price allocation all work. The remaining
  no-op is confined to the pre-built metafield query or the full candidate runtime graph.
- Version `cart-transform-poc-dev-34` is the next bisect layer: it keeps the exact successful
  static expand implementation but uses `run.dev.prebuilt-observe.graphql`. A fresh
  Cart-to-Checkout result will determine whether merely adding the candidate query causes
  the hosted failure. Huang cleared the Cart, added the product again, and confirmed the
  three components still expanded correctly. The candidate query/input delivery layer is
  therefore proven safe.
- Version `cart-transform-poc-dev-35` executed the real
  `extractPrebuiltBundleRuntimeFunctionInput` path and then returns the proven static expand.
  Huang cleared the Cart, re-added the parent, entered Checkout, and confirmed the expected
  three components remained visible. The server-input extraction layer is therefore safe in
  Shopify's hosted runtime.
- Version `cart-transform-poc-dev-36` ran with message
  `prebuilt-candidate-build-static-probe-bisect`. It executes the complete candidate build
  graph, discards that candidate, and returns the proven static expand. Read-only verification
  confirmed the single Cart Transform registration still resolved to the single installed
  `Master Kit Expand` Function. Huang's fresh Cart and Checkout screenshots showed only the
  `$100.00` parent line. Candidate construction therefore does not complete successfully in
  Shopify's hosted runtime, even though the same path passes local tests.
- Version `cart-transform-poc-dev-37` ran with message
  `prebuilt-candidate-import-static-probe-bisect`. It retains the complete candidate module
  graph but does not call the candidate builder before returning the proven static expand.
  Huang confirmed a fresh Checkout still displayed the expected component expansion. The
  complete module graph therefore loads successfully; the version 36 failure occurs while
  executing candidate construction rather than during module initialization.
- Version `cart-transform-poc-dev-38` ran with message
  `prebuilt-metadata-lookup-static-probe-bisect`. It executes the proven input extraction plus
  Cart Metadata V1 observation, mapping lookup, and Snapshot lookup, but does not enter fixed
  selection resolution or result construction. It then returns the proven static expand.
- Huang confirmed version 38 displayed one parent line in Cart and the expected three
  components in Checkout at `$100.00`. That is the accepted user-facing behavior; no more
  intermediate static probes are required.
- The dynamic hosted path was then reduced without weakening its trust boundary: the shared
  validated resolver core was separated from Admin-only validation dependencies, a compact
  Function-specific Snapshot validator retains checksum/content, parent, component, pricing,
  mapping, and Metadata V1 checks, and hosted candidates no longer allocate detailed local
  diagnostic graphs or duplicate deep clones.
- Full local validation passed after this change: app tests, 50 Function test files / 358
  Function tests, lint, Remix build, local validation, production-clean, and diff check.
- Version `cart-transform-poc-dev-39` was deployed with message
  `prebuilt-candidate-lean-hosted-runtime`. It is the real mapping/Snapshot-driven candidate,
  not a static probe. The single Cart Transform registration still resolves to the single
  installed `Master Kit Expand` Function, and local production artifacts were restored clean.
- Huang's version 39 Checkout screenshot showed only the `$100.00` parent. The dynamic
  candidate therefore remains unaccepted in Shopify's hosted runtime despite passing local
  tests. The version 39 deployment replaced a known-good diagnostic fallback too early.
- Version `cart-transform-poc-dev-40` is now active with message
  `restore-last-known-good-checkout-expansion`. It restores the exact version 38 profile while
  preserving the same verified Cart Transform registration. Dynamic work must continue locally
  without replacing this known-good development-store behavior until stronger hosted evidence
  exists.
- Huang subsequently confirmed version 40 again displays the expected EFI, Fuel, and Ignition
  components in Checkout at `$100.00`. Version 40 is the frozen development-store baseline.

## Attempts already made

1. Removed `structuredClone` from the pre-built candidate runtime path and replaced
   it with a local plain-value clone helper.
2. Split the lightweight mapping lookup from the catalog compiler so the Function
   candidate no longer imports the local catalog/compiler dependency graph.
3. Added source-isolation tests to ensure the candidate does not import the catalog
   compiler module.
4. Built and deployed development app version `cart-transform-poc-dev-28`.

The hosted result remained a no-op for the pre-built line. Do not infer that the local
resolver or Cart metadata is the failing layer.

## Important diagnostic limitation

The local Shopify Function runner is not authoritative in this repository: it returned
an empty operation result for the known hard-coded Builder fixture as well as for the
pre-built candidate. It cannot prove or disprove Shopify-hosted execution here.

## Local generic projection implementation

- Fixed selections now compile at publication time into the checksum-bound
  `prebuilt_bundle_expand_projection.v1` document.
- A new dev-only `prebuilt-projection-candidate` Function profile reads only
  `aces_dev.prebuilt_bundle_expand_projection_v1`; it does not query or resolve
  the complete mapping/Snapshot graph during Checkout.
- The candidate validates the projection checksum, parent Product/Variant,
  Metadata V1, single-quantity rule, duplicate bundle IDs, operation shape, and
  fixed prices before emitting any expand operation.
- The runtime catalog now carries the compiled projections alongside its legacy
  mappings so the next publication/persistence batch can write the projection
  without re-resolving selections.
- The development Shopify persistence adapter now supports projection read,
  checksum-CAS write, validated read-back, drift rejection, and recoverable
  rollback without enabling any live write path.
- A local projection publication orchestrator now performs preparation, CAS
  write, read-back verification, immutable audit, idempotent retry, and reverse
  compensation. Unsupported first-write deletion is surfaced explicitly for
  manual reconciliation instead of being hidden.
- Import review confirmation and ledger idempotency are now bound to a target
  fingerprint covering the complete configuration and fixed selections; reviewed
  target content can no longer change while retaining the same confirmation token.
- Bundle Admin now has an authenticated, fail-closed execution command that
  re-reviews the complete package server-side before accepting confirmation.
  The development Shopify composition now includes a durable Shop-metafield ledger
  using `compareDigest` CAS and the resumable target writer behind the dedicated
  `BUNDLE_ADMIN_PREBUILT_IMPORT_EXECUTION_ENABLED=true` gate. The gate is off by
  default and the review UI still performs no writes.
- A Shopify-shaped local integration now covers review, exact confirmation, pending
  ledger creation, Definition/Revision/Snapshot/projection/pointer/audit persistence,
  completed ledger transition, and an exact idempotent retry. It also exposed and
  fixed the server composition's invalid `randomUUID("revision")` invocation.
- Local profile build produced a Shopify Function WASM successfully. Full
  Function validation passes 53 files / 370 tests, and the production query,
  generated types, and artifact were restored and verified clean. Nothing was
  deployed; version 40 remains active.

## Development-store import rehearsal result

- After Sealos was restarted, the embedded `cart-transform-poc-dev` Bundle Admin
  loaded normally. The earlier connection-reset page was service availability, not
  an application regression.
- The isolated pre-built import rehearsal completed Definition, published Revision,
  Runtime Snapshot, compact projection, active pointer, publication audit, and the
  completed Shop ledger with exact read-back parity.
- Re-running the same reviewed package returned `already_completed` without creating
  another target.
- The retained failure sample remains at `definition_staged`, has no runtime carriers
  or publication audit, is classified `requires_target_reconciliation`, and cannot be
  automatically retried.
- All rehearsal carriers use dedicated `aces_dev.*_import_rehearsal_v1` keys. Version
  40, its Cart Transform registration, product data, theme, price, and inventory were
  not changed by this rehearsal.

## Required next implementation

Detailed incomplete items and their evidence gates are maintained in
`PREBUILT_PILOT_OUTSTANDING_WORK_2026-07-20.md`.

1. Keep version 40 active as the known-good development-store behavior.
2. The vendor-neutral read-only JSON source adapter, mapping Schema, CLI pipeline,
   and embedded Admin review entry are complete locally. Obtain one real paid-app
   export sample and fill the explicit mapping profile; do not infer missing Shopify
   GIDs or enable bulk writes.
3. Prepare one explicitly approved product-series acceptance covering Cart -> Checkout
   -> Order -> component inventory -> fulfillment, with a fixed rollback boundary.
4. Continue generic projection/hosted Function investigation locally; the next hosted
   change must preserve version 40 as the known-good fallback.
5. Keep Shopify Collective behavior as an unresolved stakeholder requirement until
   Josh confirms whether downstream supplier fulfillment needs only the main SKU or
   component-level inventory/fulfillment.

## Relevant implementation paths

- `extensions/master-kit-expand/src/run.dev.prebuilt-candidate.js`
- `extensions/master-kit-expand/src/run.dev.prebuilt-static-probe.js`
- `extensions/master-kit-expand/src/config/prebuilt-bundle-runtime.function-candidate.js`
- `extensions/master-kit-expand/src/config/prebuilt-bundle-runtime.function-input.js`
- `extensions/master-kit-expand/src/config/prebuilt-bundle-runtime.local-candidate.js`
- `extensions/master-kit-expand/src/config/prebuilt-bundle-runtime.candidate-promotion.js`
- `extensions/master-kit-expand/src/config/prebuilt-bundle-runtime.catalog-lookup.js`
- `extensions/master-kit-expand/src/queries/run.dev.prebuilt-observe.graphql`
- `scripts/build-function.mjs`
- `scripts/deploy-function-profile.mjs`
- `scripts/diagnose-dev-prebuilt-runtime-input.mjs`

## Explicit non-actions for this handoff

- Do not switch production Runtime Snapshot authority.
- Do not touch the Custom Distribution App.
- Do not recreate or delete the Cart Transform registration.
- Do not modify products, variants, prices, inventory, storefront theme, or Builder.
- Do not overwrite `aces_dev.bundle_runtime_snapshot_test`, production keys, or the
  active runtime Snapshot/pointer while diagnosing this issue.
