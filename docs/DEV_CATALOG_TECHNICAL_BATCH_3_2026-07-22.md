# Development Catalogue Technical Batch 3

## Scope

- Development app: `cart-transform-poc-dev`
- Development store: `huang-mvqquz1p.myshopify.com`
- Batch: `large-component-breadth-acceptance-v1`
- Quantity-one representatives: `AS2014B-BT` (8 components), `AS2014B2-FK-4005P` (10 components), and `AS2014B2-MK-2011-4005P` (12 components)
- Initial persistence scope did not change production, the Custom Distribution App, theme, inventory, or Function state. Later explicitly approved storefront acceptance actions are recorded below.

## Evidence

- Deterministic selection completed with checksum `7bf59e1a`.
- Local readiness found no blocked records; all three required live catalogue read-back.
- Development-store read-back confirmed every parent and component Variant is unique, `ACTIVE`, and exact-price matched.
- All three parent products currently have no `onlineStoreUrl`.
- The active offline session lacks `read_inventory`; the diagnostic safely downgraded to catalogue-only fields and recorded `inventory_readback=unavailable_scope` instead of hiding the missing evidence.
- Existing development Definitions scanned: `10`; ownership collisions: `0`.
- Draft Definitions, Revisions, Snapshots, and Projections compiled for all three records.
- Dry-run import review: `3 ready_for_confirmation`, `0 rejected`; package fingerprint `31407802`.
- Execution manifest checksum: `43220d08`.
- Fresh local verification passed 117 test files / 671 tests and the complete `npm run validate:local` gate, including Function tests and production-clean restoration.

## Current Gate

The approved development-store persistence batch completed for all three records. Each target persisted and read back an exact Definition, published Revision, Runtime Snapshot, expand Projection, active pointer, PublicationRecord, and completed import ledger. Every result returned `durable_target_complete` with `recovery_required=false`.

An immediate idempotent apply replay returned `already_completed` for all three records with `shopify_writes_performed=false`. Inventory and storefront acceptance remain later controlled gates and must not be inferred from the catalogue-only read-back. All three parent products still require an Online Store visibility decision before a real Cart-to-Checkout acceptance window.

Shopify Admin UI read-only inspection refined that visibility evidence: `AS2014B-BT` is already selected for the Online Store channel, while `AS2014B2-FK-4005P` and `AS2014B2-MK-2011-4005P` are not. The default product template preview renders the first parent with the native Dawn form, but the three new parent SKUs do not yet have dedicated `Prebuilt bundle metadata` Theme App Extension blocks. No channel or theme change was saved during this inspection.

## 2026-07-22 Storefront Acceptance Diagnosis

- A fresh Shopify Admin read-back through each publication dialog showed all three parent products selected for the Online Store channel. No duplicate publication write was made.
- Theme `test-data` (`186771538198`) now has one exact `Prebuilt bundle metadata` block for each parent SKU: `AS2014B-BT`, `AS2014B2-FK-4005P`, and `AS2014B2-MK-2011-4005P`. The saved theme was reloaded and all three values were read back.
- The first storefront attempt exposed a stale transient `shopify app dev` preview asset whose JavaScript URL returned `404`. The previously approved `app dev clean` restored active development version `cart-transform-poc-dev-63`; the stable Theme App Extension asset then loaded and hydrated both Dawn forms with all six Bundle Metadata V1 properties.
- A fresh `AS2014B-BT` add-to-cart produced exactly one parent line and the correct six properties in `/cart.js`: bundle instance UUID, schema version `1`, parent Product GID, parent Variant GID, parent SKU, and parent title.
- The persisted expand Projection is internally valid: parent identities match the cart line, it contains exactly eight components, and component fixed prices total `$989.99`, exactly matching the parent price.
- An approved exact inventory window changed only `AZ0004`, `AZ0010`, `AZ0009`, `AE1052`, `AE1060`, `AH2500`, `AZ0042`, and `AS2038` at `Shop location` from `available=0 / on_hand=0` to `1/1`. A fresh Cart-to-Checkout attempt still retained the parent line, disproving inventory as the sole root cause.
- The cart was then cleared and all eight inventory items were restored with compare-and-set from `1/1` to the exact `0/0` baseline. Read-back confirmed `committed=0` for every item. No checkout details were entered and no order was submitted.
- Read-only live diagnostics confirmed active development version `cart-transform-poc-dev-63`, Cart Transform registration `gid://shopify/CartTransform/136675606`, Function ID `019f5e8c-0374-7577-b756-66af47a751be`, and a resolving Function binding. Registration existence was not treated as proof of successful execution.
- Exact local Wasm replay of the persisted eight-component Projection used `17,282,702` instructions on the deployed v63-equivalent code path. Shopify's current limit is `11,000,000` instructions, so hosted Checkout falls back to the parent line before the expand result can be applied.

## Local Runtime Hardening After Diagnosis

- The dev-only single-Projection path now avoids duplicate candidate promotion, redundant deep freezing, redundant result-shape traversal, and repeated parent metadata allocation. Projection checksum calculation also uses a specialized canonical serializer with publication parity tests.
- A repeatable local performance gate now builds the dev Projection profile, runs synthetic 8/10/12-component cases, and always restores production Function artifacts in `finally`.
- Current representative gate: 8 components pass at `9,803,754` instructions; 10 components fail at `11,571,274`; 12 components fail at `13,336,891`. Exact instruction counts vary with payload strings, but the pass/fail boundary is stable enough to block large-breadth release.
- The 8-component local candidate is eligible for a separately approved dev-only deployment and hosted verification. The 10/12-component candidates require an architecture-level runtime change (for example a lower-cost Function implementation) or an explicitly approved contract revision; business metadata will not be silently removed to fit the limit.
- Production entry/query/generated types/Wasm were restored and passed the production-clean assertion after every local benchmark. No Function deployment, production store write, Custom Distribution App change, commit, or push was performed.

## 2026-07-22 v64 Hosted Acceptance

- After explicit approval, the optimized `prebuilt-projection-candidate` profile was deployed only through `shopify.app.dev.toml` to development app `cart-transform-poc-dev`. Shopify activated `cart-transform-poc-dev-64` (`gid://shopify/Version/1060288921601`) with message `projection-runtime-budget-hardening-8-component`.
- Fresh read-back confirmed v64 active, one Cart Transform registration `gid://shopify/CartTransform/136675606`, Function `019f5e8c-0374-7577-b756-66af47a751be`, and `allRegistrationsResolve=true`.
- The exact eight-SKU inventory window `v64-as2014b-bt-checkout-1` opened the allowlisted components from `0/0` to `1/1` with plan checksum `a7e435d8`. The native product form for `AS2014B-BT` carried all six Bundle Metadata V1 values and Cart retained one `$989.99` parent line.
- Fresh hosted Checkout expanded `Royal Flush EFI/CDI` into exactly eight quantity-one component items and preserved the `$989.99` subtotal and total. No contact, delivery, or payment data was entered and no order was submitted.
- The cart was cleared. The same window restored all eight component inventory items from `1/1` to the exact `0/0` baseline with CAS and read-back verification.
- This proves the optimized eight-component path in the hosted development runtime. It does not approve 10/12-component release, production runtime authority, production data, or the Custom Distribution App.

## Post-v64 Local Breadth Investigation

- Additional local-only hot-path work removed the duplicated Projection `value` query field, retained `jsonValue`, avoided diagnostic/freeze allocations during Function execution, validated only checksum-bound fields used by Checkout, reused parent attributes, and removed small object-factory overhead. Full publication validation remains unchanged.
- The performance gate now includes the real persisted `AS2014B2-FK-4005P` ten-component identities, titles, groups, roles, and prices instead of treating short synthetic strings as release evidence.
- The real ten-component replay currently uses `11,943,915` instructions, exceeding Shopify's `11,000,000` limit by `943,915`. Twelve components remain further over budget. Neither size is approved for deployment.
- These post-v64 changes remain local only. v64 continues to be the active development version and its hosted eight-component acceptance evidence remains valid.

## 2026-07-23 Local Rust Projection Spike

- The approved sibling prototype was generated at `extensions/master-kit-expand-rust-spike` and remains outside `scripts/function-profile.mjs`, `shopify.app.toml`, and `shopify.app.dev.toml`. Development v64 was not replaced or deployed.
- Local toolchain evidence: `rustc 1.97.1`, `cargo 1.97.1`, Rustup `1.29.0`, Visual Studio Build Tools `17.14.36`, and Shopify CLI `4.5.2`. Shopify's current Rust 2.x template requires `wasm32-unknown-unknown`; `wasm32-wasip1` is also installed but is not used by this extension.
- The Rust Function consumes the unchanged `prebuilt_bundle_expand_projection.v1` JSON and Bundle Metadata V1 attributes, emits the existing `purchase.cart-transform.run` expand shape, and fails closed for missing/invalid metadata or projection data, parent mismatch, invalid decimal or price total, empty/duplicate components, and duplicate bundle instance IDs.
- Rust unit verification passed `17/17` tests. The release Function build succeeded and produced the isolated Wasm artifact.
- The optimized Rust Wasm is `72,715` bytes, below Shopify's `256 KB` Function binary limit.
- Shared fixtures reproduce the accepted JavaScript instruction evidence exactly: synthetic 8 `9,322,255`, real 10 `11,943,915`, and synthetic 12 `12,685,182`.
- Rust parity and budget gate results:

| Fixture | JavaScript instructions | Rust instructions | Rust headroom to 11M | Parity | Gate |
| --- | ---: | ---: | ---: | --- | --- |
| synthetic 8 | 9,322,255 | 430,656 | 10,569,344 | pass | pass |
| real 10 `AS2014B2-FK-4005P` | 11,943,915 | 515,344 | 10,484,656 | pass | pass |
| synthetic 12 | 12,685,182 | 609,150 | 10,390,850 | pass | pass |

- Parity is exact for object fields, component order, quantities, attributes, IDs, titles, and prices. The sole lexical normalization is restricted to the GraphQL Decimal amount path, where the JavaScript runner emits values such as `"10.00"` and `shopify_function 2.2` emits the numerically equivalent `"10.0"`.
- Decision: `integrate`. All fixtures pass functional parity and the preferred 8,800,000-instruction engineering target with substantial headroom. This decision authorizes preparation of a separate development-only integration/deployment review; it does not authorize deployment, Cart Transform registration changes, production work, commit, or push.
- Fresh full local verification passed: Rust `17/17`; repository Vitest `119 files / 682 tests`; Function Vitest `67 files / 435 tests`; `npm run lint`; `npm run build`; `npm run validate:local`; `npm run assert:function:production-clean`; and `git diff --check`.

## 2026-07-23 v65 Rust Development Candidate (v64 Retained)

- A guarded staging path reused the existing Function UID
  `67c62dc1-f689-b420-3491-32bd242a5a2d29f7d2c6` and handle
  `master-kit-expand`; normal `shopify.app.dev.toml` and
  `shopify.app.toml` remained unchanged. The staged app configuration exposed
  exactly one Function and the existing Theme App Extension.
- The guarded flow created `cart-transform-poc-dev-65`
  (`gid://shopify/Version/1061335891969`) with message
  `rust-projection-breadth-candidate`. It was briefly activated during the
  hosted verification attempt, then the pre-existing
  `cart-transform-poc-dev-64` (`gid://shopify/Version/1060288921601`) was
  explicitly restored to honor the locked `keep v64 / no deployment` boundary.
  Final read-back records v64 as `active` and v65 as `inactive`.
- Fresh final read-back retained Cart Transform registration
  `gid://shopify/CartTransform/136675606` and Function
  `019f5e8c-0374-7577-b756-66af47a751be`; `allRegistrationsResolve=true`.
  Registration delete/create was never used.
- Pre-release gates passed: Rust `17/17`, integration contract `12/12` at
  release time, JS/Rust parity for 8/10/12 components, Rust instruction budget,
  repository Vitest `120 files / 695 tests`, Function Vitest `67 files / 435
  tests`, lint, Remix build, local validation, production-clean assertion, and
  `git diff --check`.
- A fresh read-only catalogue/inventory query confirmed the 10- and 12-component
  parent and component identities. A component-only Option C inventory plan
  (`checksum 58a11679`) selected seven exact `0/0` components and excluded
  parents, the 8-component-only `AS2038`, and already sellable components.
- Inventory window `v65-rust-breadth-checkout-1` opened those seven components
  from exact `0/0` to `1/1`, with mutation receipt and read-back verification.
  Browser inspection confirmed `AS2014B2-FK-4005P` renders with its exact parent
  Variant and all six Bundle Metadata V1 fields.
- The in-app browser could not dispatch the Add to Cart click because its page
  interaction was blocked by the browser security policy. `/cart` remained
  empty, so hosted Checkout expansion was not claimed. Before stopping, the
  same inventory window restored all seven components from exact `1/1` to
  `0/0` with CAS and read-back verification.
- Huang subsequently authorized a bounded hosted acceptance window. v65 was
  activated without creating a new version or changing the Cart Transform
  registration, and inventory window `v65-rust-breadth-checkout-2` moved the
  same seven components from exact `0/0` to `1/1` with read-back verification.
- Manual storefront evidence passed both breadth cases:
  - `AS2014B2-FK-4005P`: Cart retained one parent line; Checkout displayed ten
    component items; subtotal and total were `$1,409.99`.
  - `AS2014B2-MK-2011-4005P`: Cart retained one parent line; Checkout displayed
    twelve component items; subtotal and total were `$1,739.99`.
  No customer/payment data was entered and no order was submitted.
- The test cart was cleared after acceptance. The inventory restore mutation
  completed, but its first post-write read-back encountered transient Shopify
  CLI DNS failure (`ENOTFOUND app.shopify.com`). A subsequent write-free
  read-back confirmed all seven exact SKUs at `available=0 / on_hand=0`, so no
  mutation retry was sent.
- Final read-back restored `cart-transform-poc-dev-64` as `active`, retained v65
  as `inactive`, preserved the original Cart Transform registration and
  Function ID, and reported `allRegistrationsResolve=true`.

## 2026-07-23 Local Rust Hybrid Hardening (No Deployment)

- The sibling Rust candidate now includes the current hard-coded Shared Core as
  well as the pre-built Projection path. This closes the v65 projection-only
  gap without changing Option C or the active v64 development runtime.
- Projection `jsonValue` is ingested as raw JSON and parsed fallibly inside the
  Function. Missing fields and wrong field types no longer panic before
  `run()`; malformed pre-built input is suppressed while a valid Shared Core
  line remains expandable.
- Production JavaScript and Rust Wasm exact-output parity passes for Standard,
  Advanced, compatibility, and legacy Shared Core cases. Canonical Projection
  checksum/header/protected-field validation remains fail closed.
- The default release preflight passes for a conservative single-line envelope
  of 19 worst-string components (`4,901,556` instructions). Multi-line probes
  are recorded as unsupported boundaries: real 19-component bundles lose the
  20% margin at five lines and exceed 11M at six; worst-string 19-component
  bundles lose the margin at two lines and exceed 11M at three.
- Bundle Admin now exposes a bounded, authenticated, read-only import recovery
  assessment. The server re-reviews source input, validates at most 25 unique
  identities, includes `import_id` in ledger consistency, and batch-reads Shop
  metafields without exposing execute, publish, or rollback actions.
- Fresh local verification passed repository Vitest, Function Vitest (67 files /
  443 tests), Rust tests (35/35), Shared Core parity (4/4), lint, Remix build,
  the full local validation pipeline, the Rust release preflight, and the
  production-clean assertion. No Shopify write, deployment, commit, or push was
  performed in this hardening batch.

## 2026-07-23 v67 Rust Hybrid Hosted Acceptance

- v66 was created inactive but was never activated after read-only live evidence
  showed that the Builder Standard EFI and ignition Variant IDs had been
  replaced. It remains inactive.
- Exact live identity resolution replaced EFI `51552319766806` with
  `51592538587414` and ignition `51552321011990` with `51592730706198`;
  fuel `51505348346134` remained unchanged. Current JavaScript/Rust authority
  treats the retired IDs as untrusted Builder input, falls back to the current
  trusted Standard identities, and never emits the retired identities.
  Positive fixtures use only current identities; read-back and inventory
  planning retain the retired identities only to reject them explicitly.
- Guarded candidate `cart-transform-poc-dev-67`
  (`gid://shopify/Version/1061480300545`) was created and temporarily activated
  only on `cart-transform-poc-dev`. Its staged Wasm was `108,602` bytes with
  SHA256
  `16c43cd42cbaeaafe0c5d9b580c491678702527e144432b6039df97c19dc86c6`.
- The Rust crate now tracks `Cargo.lock`, and build/test/extension build use
  `--locked`. Activation preflight requires the live candidate Version GID and
  exact approved Wasm size/SHA256; missing or drifting evidence fails closed.
  Ambiguous activation errors force one idempotent v64 release even when an
  initial read-back still shows stale v64-active state, followed by independent
  baseline and registration verification.
- Inventory window `v67-rust-hybrid-checkout-1` (checksum `731e6cfb`) opened
  exactly nine component inventory items from `0/0` to `1/1`; parents were
  excluded and already sellable components were no-action.
- Hosted Checkout passed Builder Standard (3 components, `$750.48`), pre-built
  8 (`$989.99`), pre-built 10 (`$1,409.99`), pre-built 12 (`$1,739.99`), and a
  mixed Builder-plus-pre-built-8 cart (two parent groups, `$1,740.47`).
- No contact, delivery, or payment data was entered and no order was submitted.
  The cart was cleared. The same CAS window restored all nine component
  inventory items from exact `1/1` to `0/0` with read-back verification.
- Final state restored v64 active; v65/v66/v67 are inactive. The existing Cart
  Transform registration and Function ID still resolve. Production, the Custom
  Distribution App, commit, and push were not touched.
