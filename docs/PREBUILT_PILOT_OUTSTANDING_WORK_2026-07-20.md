# Pre-built Bundle Pilot Outstanding Work — 2026-07-20

Status: active engineering backlog under the V5.4 locked baseline. This document
records incomplete work and external dependencies; it does not authorize deployment,
Shopify writes, inventory changes, or a production authority switch.

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

## Outstanding work

| ID | Work | Current state | Dependency / completion evidence |
| --- | --- | --- | --- |
| OW-01 | Obtain one real export from the current paid Bundles application. | Blocked on external sample. | Josh/team supplies a sanitized JSON export containing source bundle identity, parent Shopify GID, component Shopify GIDs, and quantities. |
| OW-02 | Bind and verify the real export mapping profile. | Code ready; data mapping incomplete. | `prebuilt_bundle_source_mapping.v1` produces canonical records with zero rejected pilot records and reviewed source/package fingerprints. |
| OW-03 | Release the accumulated local Bundle Admin/raw-review batch to Sealos. | Not released. | Separate commit/push/release approval, successful Pod startup, `/healthz`, and embedded Admin regression. |
| OW-04 | Select and freeze the single-series pilot boundary. | Not selected. | Approved store, series key, parent Variant GIDs, expected component GIDs, test quantities, owner, and rollback window. |
| OW-05 | Capture pre-test product and inventory baseline. | Not started. | Read-only product/Variant identity and inventory snapshots retained before any pilot order. |
| OW-06 | Run Cart and Checkout acceptance. | Existing test SKU visually passed; formal pilot evidence incomplete. | `/cart.js` proves one parent line and Metadata V1; Checkout proves the exact component set and total for the approved pilot package. |
| OW-07 | Run Order and inventory acceptance. | Not started. | Order Admin contains expected expanded components; parent inventory delta is zero; each component inventory delta matches ordered quantity. |
| OW-08 | Confirm fulfillment and Shopify Collective semantics. | Waiting for Josh. | Decide whether supplier-side orders/fulfillment keep only the main SKU or require component-level handling. Record the decision before pilot acceptance. |
| OW-09 | Validate rollback and monitoring boundary. | Locally designed; live pilot evidence incomplete. | Known-good version 40 fallback, operator steps, alerts, reconciliation owner, and post-rollback Cart/Checkout regression accepted. |
| OW-10 | Resolve retained rehearsal records. | Intentionally retained. | Decide whether isolated successful/failed rehearsal Metaobjects and `aces_dev.*_import_rehearsal_v1` metafields remain as audit evidence or are removed through an approved cleanup. |
| OW-11 | Generic pre-built runtime promotion. | Not approved. | Hosted Function evidence, known-good fallback, full pilot acceptance, and explicit Function deployment approval. |
| OW-12 | Production migration and rollout. | Not approved. | Production resource design, access controls, migration plan, observability, runbook, rollback ownership, and production authorization. |
| OW-13 | Reconcile legacy Shopify native Bundle relationships on Combined Listing products. | Local prevention, batch planning, owner constraint, and acceptance checker complete; existing store state unverified. | Run the approved read-only diagnostic, identify the owner App, perform separately approved Unlink cleanup, then pass image/price/Compare-at price, Combined Listing, Cart/Checkout, and pilot acceptance evidence. |

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

- A real paid-app export sample is required before claiming vendor compatibility.
- Shopify product/inventory/order writes or a real pilot order require explicit scope
  and approval.
- Sealos release, commit, push, Function deployment, and production resource work
  remain separate external actions.
- The Collective fulfillment decision must not be guessed.
