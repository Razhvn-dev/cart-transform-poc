# Pre-built Bundle Pilot Outstanding Work — 2026-07-20

Status: active engineering backlog under the V5.4 locked baseline. This document
records incomplete work and external dependencies; it does not authorize deployment,
Shopify writes, inventory changes, or a production authority switch.

Work paused at the end of 2026-07-20 after completing the single-bundle development
import and validation milestone. Resume from OW-05; do not repeat the completed
catalogue import.

## Completed foundations

- Version 40 remains the verified development-store Checkout expansion baseline.
- The isolated development-store import rehearsal completed durable target persistence,
  exact idempotent retry, and partial-write recovery classification.
- The vendor-neutral raw JSON adapter, declarative mapping Schema, local CLI pipeline,
  and embedded Bundle Admin read-only review path are implemented locally.
- Production Function authority remains the hard-coded Shared Core.
- A synthetic, browser-only pre-built import demo can prefill the Admin review form
  and produce a deterministic dry-run plan without creating Shopify data.
- Bundle Admin read-only Shopify queries use bounded transient retries; mutations are
  never automatically retried. Exhausted list reads return `PERSISTENCE_FAILED`
  instead of an unclassified `INTERNAL_ERROR`.
- Huang explicitly authorized a development-store-only data import on 2026-07-20.
  The captured Bundles.app parent and 13-component package is now persisted in
  `huang-mvqquz1p.myshopify.com` under BundleDefinition
  `7a9dcb4e-6b44-4db7-8c6a-202607200011`. The import ledger is completed and an
  exact retry returned `already_completed`.

## Outstanding work

| ID | Work | Current state | Dependency / completion evidence |
| --- | --- | --- | --- |
| OW-01 | Obtain a complete relationship source from the current paid Bundles application. | Completed locally. | Josh's team supplied `sku_pricing.xlsx`; it contains 2,052 relationship rows and is paired with the 5,644-row Variant identity CSV. |
| OW-02 | Bind and verify the real source format. | Full-catalogue relationship/identity preflight completed. | 1,554 unique parent SKUs; 498 exact duplicate relationships; 1,148 ready for mapping; 406 blocked only by repeated component quantities. See `docs/BUNDLES_APP_CATALOG_PREFLIGHT_2026-07-21.md`. |
| OW-03 | Release the accumulated local Bundle Admin/raw-review batch to Sealos. | Huang reports the 2026-07-20 release is running. | Embedded regression and exact deployed commit remain to be recorded before treating release evidence as complete. |
| OW-04 | Select and freeze the single-series pilot boundary. | Development data scope selected; execution window incomplete. | Parent SKU `AS2212CG2-MK-2011-4005P`, 13 component Variants, BundleDefinition/revision identity, test quantities, owner, and rollback window must be copied into the formal acceptance evidence before order testing. |
| OW-05 | Capture pre-test product and inventory baseline. | Not started. | Read-only product/Variant identity and inventory snapshots retained before any pilot order. |
| OW-06 | Run Cart and Checkout acceptance. | Imported package is not storefront-enabled; formal pilot evidence incomplete. | Publish only the pilot parent to the intended development sales channel after separate approval, then `/cart.js` must prove one parent line and Metadata V1 while Checkout proves the exact 13-component set and total. |
| OW-07 | Run Order and inventory acceptance. | Not started. | Order Admin contains expected expanded components; parent inventory delta is zero; each component inventory delta matches ordered quantity. |
| OW-08 | Confirm fulfillment and Shopify Collective semantics. | Product intent received; platform capability unverified. | Josh prefers supplier-side component expansion but believes Collective may not support it. Verify live capability; retain main-SKU-only pass-through as fallback. |
| OW-09 | Validate rollback and monitoring boundary. | Locally designed; live pilot evidence incomplete. | Known-good version 40 fallback, operator steps, alerts, reconciliation owner, and post-rollback Cart/Checkout regression accepted. |
| OW-10 | Resolve retained rehearsal records. | Intentionally retained. | Decide whether isolated successful/failed rehearsal Metaobjects and `aces_dev.*_import_rehearsal_v1` metafields remain as audit evidence or are removed through an approved cleanup. |
| OW-11 | Generic pre-built runtime promotion. | Not approved. | Hosted Function evidence, known-good fallback, full pilot acceptance, and explicit Function deployment approval. |
| OW-12 | Production migration and rollout. | Not approved. | Production resource design, access controls, migration plan, observability, runbook, rollback ownership, and production authorization. |
| OW-13 | Reconcile legacy Shopify native Bundle relationships on Combined Listing products. | Local prevention, batch planning, owner constraint, and acceptance checker complete; existing store state unverified. | Run the approved read-only diagnostic, identify the owner App, perform separately approved Unlink cleanup, then pass image/price/Compare-at price, Combined Listing, Cart/Checkout, and pilot acceptance evidence. |
| OW-14 | Support source component quantities above `1`. | Architecture proposal required. | 406 real parent SKUs contain `x2`, `x4`, or `x8`. V5.4 runtime and import contracts remain quantity-one; prepare a V5.5 proposal with price, Function, Checkout, Order, inventory, and rollback evidence before implementation. |

## Development-store import evidence

- Target: development app `cart-transform-poc-dev` and store
  `huang-mvqquz1p.myshopify.com` only.
- Shopify catalogue writes: seven isolated `[ACES Pilot]` products containing twelve
  newly created Variants; existing `AC2008` and `AS2021` Variants were reused.
- Parent Variant: `gid://shopify/ProductVariant/51590540427542`.
- Active revision: `f33d5cf9-b1a0-4067-a3d9-df07bcd3e016`.
- Publication audit: `7a9dcb4e-6b44-4db7-8c6a-202607200024`, success `true`.
- Snapshot checksum: `5b4f172e`; projection checksum: `f6e7d2a0`.
- Read-back verified one published revision, matching active pointer, 13 projection
  components, and one successful publication record.
- The pilot products were not published to Online Store. No Function deployment,
  Cart Transform registration change, inventory mutation, order, commit, or push
  was performed.
- Two failed import ledgers caused by transient Shopify CLI TLS failures are retained
  as audit evidence. The first performed no target writes; the second stopped after
  the staged Definition/revision boundary and was reconciled into the completed
  target above without duplicating the revision.

## Full-catalogue development import — 2026-07-21

- The operator successfully imported the real Shopify product CSV through Shopify
  Admin into `huang-mvqquz1p.myshopify.com`: 235 products and 5,644 SKUs reported
  by the Shopify import preview.
- Twenty-three obsolete development-only products were then removed; the six POC
  regression products, including `master-kit-test` and `prebuilt-bundle-test`, were
  preserved. Final read-back count: 241 products, with no cleanup candidates left.
- This is a normal product/variant catalogue import, not a Bundle Admin or Cart
  Transform migration. No full-catalogue relationships, runtime snapshots, Function
  activation, inventory changes, orders, or production resources were written.
- A local-only candidate pass then resolved every parent/component SKU for all 1,148
  quantity-one records once against the imported product CSV. It intentionally did
  not infer product-series keys, Shopify GIDs, Bundle Admin targets, or a runtime
  activation.
- Full evidence is recorded in
  `docs/DEV_STORE_CATALOG_IMPORT_AND_CLEANUP_2026-07-21.md`.

## Work that can continue locally now

1. The pilot acceptance evidence contract and fail-closed checker are implemented locally.
2. Deterministic fixtures cover Cart, Checkout, Order, inventory, fulfillment,
   and rollback evidence without calling Shopify.
3. Keep source normalization, package planning, and Admin read-only review hardened.
4. Fill `docs/examples/prebuilt-bundle-pilot-acceptance.template.json` after the
   real pilot is approved. Replace every `REPLACE` placeholder; the evidence contract
   is defined by `docs/schemas/prebuilt-bundle-pilot-acceptance.v1.schema.json`. Then run:

   ```text
   npm run check:prebuilt-bundle-pilot -- --input <evidence.json>
   ```
5. Native Bundle conflict inventory and post-cleanup acceptance contracts are
   complete locally. They remain non-mutating until a real product scope and
   owner-App cleanup are approved.

## External stop boundaries

- The full relationship export is available and locally preflighted. Full-catalogue
  migration is still blocked for 406 repeated-quantity records and remains unapproved
  for Shopify execution.
- Further Shopify publication, inventory/order writes, or a real pilot order require
  explicit scope and approval. The development catalogue import above is complete.
- Sealos release, commit, push, Function deployment, and production resource work
  remain separate external actions.
- The Collective fulfillment decision must not be guessed.
