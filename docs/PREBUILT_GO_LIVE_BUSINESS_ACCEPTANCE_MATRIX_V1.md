# Pre-built Go-live Business Acceptance Matrix V1

Status: V5.5 planning draft. It does not authorize Shopify access or writes.

## Product decisions confirmed by Josh — 2026-07-24

- Partial refund policy: an individual component or one unit from a repeated
  quantity may be refunded; only that returned quantity is restored when
  restocking is selected.
- Supplier/Collective presentation: use the main Kit SKU only for now. Internal
  Checkout, Order, and inventory authority remains component-level.
- Repeated quantity: `xN` means `N` physical units, and the listed component
  price is the per-unit price.

These are confirmed business rules, not proof that the behavior has been
implemented or validated in Shopify.

## Verified development evidence

v67 Rust hybrid passed Browser -> Cart -> Checkout for Builder Standard,
pre-built 8/10/12, and mixed Builder 3 + pre-built 8. Both temporary inventory
windows were restored. Final read-back is v64 active and v65/v66/v67 inactive.

v67 did not create an order or enter contact, delivery, or payment details.
It therefore does not prove Order, inventory, refund, fulfillment, Collective,
or production rollback behavior.

## Required scenarios

| ID | Scenario | Required evidence | External write or human gate |
| --- | --- | --- | --- |
| BA-01 | Pre-built 8/10/12 order and inventory | Order components only; parent delta 0; components -1 | Orders, inventory, manual Checkout |
| BA-02 | Mixed Builder 3 + pre-built 8 order | Independent groups and exact 3+8 deltas | Order and inventory |
| BA-03 | Multiple bundle instances | Separate quantity-one parents and unique `_bundle_id` | Product decision; full proof needs order |
| BA-04 | Large-cart budget | Supported combinations or explicit product limit | Candidate activation/manual Checkout |
| BA-05 | Price, discount, tax, rounding | Checkout/Order amount reconciliation | Discounts, tax, orders |
| BA-06 | Component out of stock | No partial/incorrect expansion; exact restore | Inventory mutation/manual validation |
| BA-07 | Parent sellability | Parent is not inventory authority | Product/inventory policy and writes |
| BA-08 | Conflict and fail-closed | Untrusted projection never creates wrong order | Local; hosted isolation needs approval |
| BA-09 | Native Bundle conflict | Owner App cleanup and storefront regression | Owner-App cleanup/manual QA |
| BA-10 | Cancellation/full refund | Component restock; parent unchanged | Order/refund/inventory |
| BA-11 | Partial refund | One component/unit can be refunded; exact amount and inventory reconciliation | Local acceptance contract and tests pass; hosted refund/order evidence remains |
| BA-12 | Fulfillment | Supplier sees main Kit SKU for now; internal order remains components | Local supplier read model and tests pass; fulfillment/manual acceptance remains |
| BA-13 | Shopify Collective | Main Kit SKU supplier presentation without changing component inventory authority | Local supplier presentation contract passes; external-store coordination/orders remain |
| BA-14 | v64 rollback | Binding plus fresh v64 Cart/Checkout smoke | Function release/inventory/manual QA |
| BA-15 | Unknown mutation result | Read-back before exact resume | Isolated failure approval |
| BA-16 | Reconciliation/monitoring | Trace, SLA, alert, owner, compensation | Read approval; fixes need write approval |
| BA-17 | Repeated quantities | x2/x4/x8 physical quantity, per-unit price, order, inventory, and one-unit refund | Local V2 compiler, JS/Rust runtime parity, publication evidence, and tests pass; hosted evidence remains |

## Repeated-quantity boundary

The 406 records remain fail-closed. The recommended future semantic is one
unique component Variant with a positive integer quantity and a per-unit fixed
price:

`sum(quantity * fixedPricePerUnit) = parent line total`

Each bundle instance remains a separate quantity-one parent line with its own
`_bundle_id`. Josh confirmed on 2026-07-24 that quantity is the physical unit
count, price is per unit, one unit may be refunded independently, and the
supplier sees the main Kit SKU for now. The local V2 implementation, amount
reconciliation contracts, and JS/Rust parity are complete; Shopify-hosted
validation is still required.
