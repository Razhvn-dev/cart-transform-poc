# Development Catalogue Technical Batch 2 — 2026-07-22

## Scope

This is a development-only technical breadth batch. It does not assign production
taxonomy or authorize production migration. The deterministic selector chose the
only titled, locally eligible quantity-one representatives for three and four
distinct components:

| Component count | Parent | Parent price | Components |
| ---: | --- | ---: | --- |
| 3 | `AS2008C` | `$139.99` | `AC2008`, `AH2008C`, `AE2008C` |
| 4 | `AS2020PS` | `$559.99` | `AS2020`, `AZ0022`, `DM300`, `AS2021` |

The frozen scope is
`docs/examples/dev-catalog-technical-batch-2.component-breadth-v1.json`.
Local selection evidence checksum is `09c2f5cd`; local readiness checksum is
`45c54809`. Fresh development-store read-back subsequently confirmed all nine
parent/component Variant identities, active product state, and exact prices.

## Local hardening completed

- Added a deterministic, local-only representative selector. It never assigns
  business taxonomy and rejects Shopify mutation flags.
- The selector accepts unknown component product state from the CSV only as an
  unresolved read-back condition; it does not treat missing CSV state as live fact.
- Development live read-back schema v2 now includes tracked inventory,
  `sellableOnlineQuantity`, inventory policy, and exact Available/On hand values at
  the development Shop location.
- Zero inventory with policy `DENY` produces an explicit acceptance-window review
  issue. This prevents a repeat of the AD2023 stock-problems ambiguity.
- Added a local-only inventory-window planner that deduplicates shared components,
  preserves already sellable stock, and only proposes reversible `0/0 -> 1/1 ->
  0/0` windows. Drifted, untracked, or incomplete inventory evidence fails closed.
- Shopify CLI read-only execution now retries the CLI request-aborted condition and
  reports the number of attempts actually performed. Mutations remain single-shot.

## Frozen execution evidence

| Parent | Definition | Revision | Snapshot | Projection | Publication |
| --- | --- | --- | --- | --- | --- |
| `AS2008C` | `fb632869-fac3-5023-a162-e5d9e7944bc9` | `2b6e7db8-397e-5cf8-aa9b-64d7bd339579` | `11907353` | `42dd44b6` | `996470e4-ac81-5c8c-9c3b-49f3a8755930` |
| `AS2020PS` | `04c42eda-e5c2-5858-b485-b63d425020a8` | `d1331d82-a398-5953-8cb7-df6a80fb6914` | `3484c8a8` | `443f06fc` | `791221e9-be63-5fff-8e2c-becbe5f841f8` |

- Collision scan covered eight existing development Definitions; both targets are
  collision-free.
- Import package fingerprint: `65b2a898`; confirmation token: `bb3db8b3`.
- Execution manifest checksum: `68907102`; exact apply phrase:
  `APPLY_DEV_BATCH_bb3db8b3`.
- Inventory plan checksum: `d1aa061a`. Seven exact 0/0 targets require controlled
  acceptance windows; `AC2008` and `AS2021` need no change.

## Current external boundary

Both targets are now fully persisted and read back. Their exact Definitions,
Revisions, Snapshots, Projections, active pointers, Publications, and completed
import ledgers match the frozen execution manifest. No partial import state remains.

The Default product template in active development theme `test-data`
(`#186771538198`) now has five isolated `Prebuilt bundle metadata` blocks. Remote
theme read-back confirms the two new exact bindings `AS2008C` and `AS2020PS` in
addition to `AF4005PK`, `AD2011-C`, and `AD2023-C`. Live storefront inspection
confirmed one matching marker per new product, the expected asset, and six Bundle
Metadata V1 properties on each of Dawn's two native cart forms.

Three controlled inventory windows were opened and restored. The seven planned SKUs
were read back at `1/1` during acceptance and at their original `0/0` after cleanup;
the latest fresh-session acceptance window was `v60-clean-session-1`. The inventory
executor now requires a fresh, stable
`--window-id` per acceptance cycle. This prevents Shopify's idempotency replay from
silently suppressing a later window while preserving safe retries within the same
cycle.

Checkout still displayed the single parent for both targets under active v59 even
though the live metadata, persisted Projection, parent price, component allocation,
and local candidate result were all exact. Active development v60
(`component-breadth-static-hosted-bisect`) adds only exact dev static probes for
these two parent Variants. A genuinely fresh incognito Cart-to-Checkout session
under v60 passed for `AS2008C`: Cart retained one `High Roller (Classic)` parent at
`$139.99`, while Checkout expanded it into exactly three component lines
(`AC2008`, `AH2008C`, and `AE2008C`) and preserved the `$139.99` total. No order was
submitted. The bounded CLI Function log stream emitted no record, but the observed
Checkout expansion proves that the active binding, hosted invocation, and static
expand payload all functioned in this session.

This bisect confines the remaining defect to the hosted v59 Projection candidate
path, not the theme metadata, Cart parent behavior, Cart Transform registration, or
Shopify's component expansion capability. v60 remains a development-only diagnostic
fallback, not the generic fix. After acceptance, all seven temporary inventory
targets were restored and read back at their original `0/0`. Production Function
artifacts passed the production-clean check and production runtime authority remains
unchanged.

The next engineering step is a finer hosted bisect inside the Projection candidate
boundary, starting from the proven v60 static payload and reintroducing persisted
Projection resolution and validation one layer at a time. A later fresh-session
Checkout validation is required only after that candidate path changes.

## 2026-07-22 generic Projection fix and hosted acceptance

The finer hosted bisect is complete:

- v61 (`projection-candidate-observable-bisect`) executed the complete persisted
  Projection candidate while returning the proven static payload. Checkout exposed
  `[projection:ready:1:1]`, proving that Metadata V1 observation, Projection parsing,
  checksum and price validation, and candidate construction all completed in the
  hosted runtime.
- v62 (`projection-promotion-bypass-bisect`) returned the real Projection candidate
  operations while bypassing only the redundant candidate clone/deep-freeze pass in
  `promotePrebuiltBundleRuntimeCandidate`. The three-component Checkout expanded
  correctly with the real component attributes and `$139.99` total.
- The generic promotion helper now reuses builder-owned, deeply frozen candidate
  operations. Shared Core operations are still cloned, non-frozen callers retain
  the previous defensive-clone behavior, and the result remains deeply frozen.

Development version `cart-transform-poc-dev-63`, message
`projection-promotion-runtime-cost-fix`, runs the repaired generic
`prebuilt-projection-candidate` profile. Fresh hosted acceptance passed for both
breadth targets:

- `AS2008C`: Cart retained one parent; Checkout showed exactly three components and
  preserved `$139.99`.
- `AS2020PS`: Cart retained one parent; Checkout showed exactly four components and
  preserved `$559.99`.

No checkout details were entered and no order was submitted. The test cart was
emptied. Inventory window `v63-projection-fix-1` restored all seven temporary SKUs
from `1/1` to their original `0/0`, with exact read-back. Fresh local verification
passed 109 test files / 640 tests, lint, application build, production-clean, and
`git diff --check`. Production runtime authority remains the hard-coded Shared Core;
the Custom Distribution App and production store were not touched.

## Inventory-window receipt hardening

Post-v63 local hardening found that the mutation idempotency key and reference URI
were correctly scoped by `window_id`, but the successful JSON receipt omitted that
identity. Future successful open/restore receipts now retain `window_id`, the exact
confirmation phrase, and the stable reference path, after verifying that every
target's before state matches the planned transition and every after state reached
the requested value. This is an evidence-format correction only; it
does not reopen the completed v63 inventory window or alter its verified `0/0`
restoration. The full local suite now passes 109 test files / 642 tests.

The batch and inventory execution results now also expose an exact
`shopify_writes_performed` flag. Inventory preparation/read-only output and batch
read-only reconciliation return `false`; a verified inventory mutation receipt
returns `true`. The batch executor returns `true` only when this invocation entered
an incomplete record's persistence path, while an all-completed idempotent apply
returns `false`. Operators and later evidence aggregation must use this flag instead
of inferring writes from `mode` or `status`.
