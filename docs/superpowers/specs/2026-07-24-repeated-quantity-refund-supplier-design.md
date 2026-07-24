# Repeated Quantity, Partial Refund, and Supplier Presentation Design

**Date:** 2026-07-24
**Status:** Approved product rules; local V5.5 design only
**Authority boundary:** V5.4 remains locked and v64 remains the active runtime

## Goal

Support repeated component quantities, individual-unit refunds, and the current
supplier main-SKU workflow without changing Option C:

- Cart keeps one parent line per bundle instance.
- Checkout and Orders expand into components.
- Inventory deducts and restores components only.
- Supplier/Collective presentation may show only the main Kit SKU.

## Confirmed Product Rules

Josh confirmed:

1. `xN` means `N` physical units must be shipped.
2. A listed component price is the price per individual unit.
3. One component or one unit from quantity `N` may be refunded independently.
4. Only the returned component quantity is eligible for inventory restoration.
5. For now, the supplier sees only the main Kit SKU and performs the breakdown
   and shipment.

## Contract Versioning

The quantity-one V1 contracts remain historical evidence and are not silently
reinterpreted. Repeated quantities use additive V2 contracts.

Each V2 component contains:

- one Shopify component Variant GID;
- a positive safe-integer `quantity`;
- a non-negative `fixed_price_per_unit`;
- stable source identity and audit provenance.

If a source repeats the same component Variant, import normalization aggregates
it into one component record before publication. A published projection must
contain each component Variant only once.

Because Shopify Function `ExpandedItem.quantity` is a signed 32-bit integer,
the locally accepted quantity range is `1..2,147,483,647`. Import and runtime
validation reject larger values before projection or expansion.

## Price Invariant

For one parent bundle instance:

```text
sum(component.quantity * component.fixed_price_per_unit)
  = parent bundle price
```

Currency minor units are authoritative for calculation. Multiplication and
summation must fail closed on unsafe integers, overflow, unsupported precision,
or a total mismatch. Discounts, taxes, and Shopify allocation are verified
from the resulting Order and refund evidence rather than guessed locally.

## Cart, Checkout, Order, and Inventory Semantics

- The parent Cart line remains quantity one for each independently identified
  bundle instance and retains its unique `_bundle_id`.
- Multiple bundle instances remain separate parent Cart lines.
- At Checkout and Order, each unique component Variant expands once with its
  physical `quantity`.
- Parent inventory delta remains zero.
- Component inventory delta equals the negative ordered component quantity.
- No client-supplied component, quantity, or price is trusted as runtime
  authority.
- `lineUpdate` and runtime `productVariantComponents` remain prohibited.

## Partial Refund Semantics

A refund selection identifies an Order component line and a positive quantity
not greater than its remaining refundable quantity.

- Refunding one unit from quantity `N` leaves `N - 1` units fulfilled unless a
  separate return or cancellation changes that state.
- The component subtotal basis is
  `refunded quantity * fixed price per unit`.
- Final refund reconciliation uses Shopify's actual discount, tax, shipping,
  and rounding allocations.
- When restocking is selected, only the refunded component quantity is
  restored.
- The parent Kit must not be independently refunded or restocked as inventory
  authority.
- Duplicate refunds, over-refunds, parent-level inventory restoration, and
  mismatched Order lines fail closed.

## Supplier and Collective Presentation

Supplier presentation is a separate read model over the internal component
Order:

- Internal Order and inventory truth remains component-level.
- Supplier-facing output contains the main Kit SKU and ordered kit-instance
  count only.
- The supplier performs its current breakdown and shipment process.
- The mapping preserves a trace back to the internal Order and bundle instance
  without exposing that identifier as supplier inventory authority.

An unsupported or ambiguous supplier mapping must be marked for review. It must
not alter the Shopify Order, component quantities, or inventory.

## Validation and Failure Rules

Reject or quarantine a record when:

- quantity is zero, negative, fractional, or not a safe integer;
- the same Variant remains duplicated after normalization;
- unit price has unsupported precision or is negative;
- multiplication or total calculation overflows;
- component total does not equal the approved parent price;
- a refund exceeds the remaining refundable quantity;
- inventory restoration targets the parent Kit;
- supplier main-SKU mapping is missing or ambiguous.

## Required Evidence

Local automated evidence:

- quantity normalization and aggregation;
- `x2`, `x4`, and `x8` projection and JS/Rust parity;
- per-unit price multiplication and rounding boundaries;
- multiple independent parent instances;
- one-unit and multi-unit refund reconciliation;
- over-refund and wrong-inventory-target rejection;
- supplier main-SKU presentation while internal components remain unchanged.

Development-store evidence requiring separate approval:

- inactive candidate build and version verification;
- Cart and Checkout for repeated quantities;
- real development orders and component inventory deltas;
- one-unit partial refund and exact restock delta;
- supplier/Collective presentation and operational acceptance;
- rollback and final read-back to v64 unless a later activation is approved.

## Non-goals

This design does not:

- modify the V5.4 SSOT;
- change the current v64 runtime;
- authorize Shopify, Collective, supplier, or inventory writes;
- deploy, activate, commit, or push code;
- migrate the 406 repeated-quantity records before all local and hosted gates
  pass.
