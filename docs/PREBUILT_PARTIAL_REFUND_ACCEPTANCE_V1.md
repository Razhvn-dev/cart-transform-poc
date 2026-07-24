# Pre-built Partial Refund Acceptance V1

## Purpose and boundary

`prebuilt_partial_refund_acceptance.v1` is a local, read-only reconciliation
contract for one refund against one component-level Shopify Order line.

The evaluator:

- consumes only the object supplied by its caller;
- performs no Shopify, network, filesystem, refund, or inventory operation;
- does not make the parent Kit an Order or inventory authority;
- does not invent discount, tax, shipping, or rounding allocations.

Its output is local acceptance evidence only. A `passed` result does not prove a
Shopify refund or inventory change unless the supplied values were captured from
the separately authorized development-store operation.

## Input

The JSON Schema is
`docs/schemas/prebuilt-partial-refund-acceptance.v1.schema.json`.

`refund_scope` identifies the accepted Order component line and declares:

- the ordered component quantity;
- the already-refunded quantity before this refund;
- the requested positive refund quantity;
- whether component restock was requested;
- the component and distinct parent Variant identities;
- the Bundle Metadata V1 instance UUID, currency, and fixed per-unit price in
  currency minor units.

`evidence` contains four independent read-back stages:

1. `order_component`: Shopify Order line identity, ordered quantity, and
   already-refunded quantity.
2. `prior_refunds`: unique prior Shopify Refund and OrderTransaction GIDs,
   bound to the same Order line and bundle instance. Use an empty array when
   there is no prior refund.
3. `refund`: the current component refund line, explicit Refund and
   OrderTransaction identities, `shopify_calculated_amount`, and
   `shopify_actual_amount`.
4. `inventory`: the refund-bound inventory adjustment read-back, including
   Order line, bundle instance, location, adjustment identity, and component
   and parent before/after quantities.

Evidence stages may be absent or `null` while evidence is being collected. The
evaluator then returns `incomplete`; JSON Schema conformance alone never means
the acceptance passed.

## Shopify amount read-back

Both amount objects must set `source` to `shopify_readback` and bind the same
Refund, OrderTransaction, Order line, bundle instance, and currency. They record:

- component subtotal;
- discount allocation;
- tax allocation;
- shipping allocation;
- rounding adjustment;
- total.

All monetary values are safe integers in currency minor units. Allocation
fields are signed contributions. The evaluator does not generate Shopify's
discount, tax, shipping, or rounding decisions. It does verify:

- `component_subtotal_minor = requested quantity * fixed unit price minor`;
- each read-back's `total_minor` equals the sum of its signed subtotal and
  allocation contributions;
- every intermediate signed addition remains within JavaScript's safe-integer
  range, so a later negative allocation cannot hide an earlier overflow;
- calculated and actual read-backs match exactly.

This verifies read-back self-consistency without rebuilding Shopify's allocation
algorithm.

## Reconciliation rules

- `ordered_quantity`, `already_refunded_quantity`, and
  `requested_refund_quantity` must match their Shopify evidence.
- The sum of unique `prior_refunds` quantities must equal the declared
  already-refunded quantity.
- A current Refund GID cannot repeat a prior Refund GID, and a prior Refund GID
  or OrderTransaction GID cannot appear twice.
- `already_refunded_quantity + requested_refund_quantity` cannot exceed the
  ordered component quantity.
- When `restock_requested` is true, the component restock delta must equal the
  requested refund quantity exactly. Otherwise it must be zero.
- The parent Variant inventory delta must always be zero.
- Component and parent Variant GIDs must be different.
- Order, refund, amount, and inventory evidence must identify the same Order
  line, bundle instance, component, parent, Refund, and OrderTransaction.
- Inventory evidence must include Location and InventoryAdjustmentGroup GIDs.
  Component and parent before/after values must independently prove their
  reported deltas.

Runtime validation mirrors the schema: objects must be plain objects with own
properties, unknown keys are invalid, arrays cannot be represented by strings,
and numeric strings are never coerced.

The returned `reconciliation.remaining_refundable_quantity` is the component
quantity remaining after the accepted refund.

## Status

Status precedence is deterministic:

1. `invalid`: the document, schema identity, scope, or typed evidence is
   malformed.
2. `failed`: present evidence contradicts the accepted identity, quantity,
   refund, or inventory invariants.
3. `incomplete`: required read-back evidence is absent.
4. `passed`: no invalid, failed, or pending issue remains.

`accepted` is true only for `passed`. Results and nested values are frozen.

## Stable issue codes

| Code                                       | Meaning                                                       |
| ------------------------------------------ | ------------------------------------------------------------- |
| `INVALID_DOCUMENT`                         | Input is not an object.                                       |
| `INVALID_SCHEMA`                           | `schema_version` is not the V1 identity.                      |
| `UNKNOWN_FIELD`                            | An object contains a field not allowed by the schema.         |
| `INVALID_EVIDENCE`                         | The evidence container is not a plain object.                 |
| `INVALID_REFUND_SCOPE`                     | Required scope identity or quantity is malformed.             |
| `UNSAFE_COMPONENT_SUBTOTAL`                | Quantity multiplied by unit price exceeds safe integer range. |
| `PARENT_COMPONENT_IDENTITY_COLLISION`      | Component and parent Variant GIDs are identical.              |
| `ORDER_COMPONENT_EVIDENCE_REQUIRED`        | Order component read-back is absent.                          |
| `INVALID_ORDER_COMPONENT_EVIDENCE`         | Order component evidence does not match schema types.         |
| `ORDER_COMPONENT_IDENTITY_MISMATCH`        | Order line or Variant does not match scope.                   |
| `ORDERED_QUANTITY_MISMATCH`                | Observed ordered quantity differs from scope.                 |
| `ALREADY_REFUNDED_QUANTITY_MISMATCH`       | Observed already-refunded quantity differs from scope.        |
| `PRIOR_REFUND_EVIDENCE_REQUIRED`           | Prior refund evidence is absent.                              |
| `INVALID_PRIOR_REFUND_EVIDENCE`            | A prior refund record is malformed or unsafe.                 |
| `PRIOR_REFUND_COMPONENT_IDENTITY_MISMATCH` | A prior refund targets another Order line.                    |
| `PRIOR_REFUND_QUANTITY_MISMATCH`           | Unique prior refund quantities do not reconcile.              |
| `DUPLICATE_REFUND_EVIDENCE`                | A Refund GID is repeated.                                     |
| `REFUND_EVIDENCE_REQUIRED`                 | Current refund evidence is absent.                            |
| `INVALID_REFUND_EVIDENCE`                  | Current Refund identity is malformed.                         |
| `REFUND_COMPONENT_IDENTITY_MISMATCH`       | Current refund targets another component line.                |
| `REQUESTED_REFUND_QUANTITY_MISMATCH`       | Observed refund quantity differs from scope.                  |
| `OVER_REFUND`                              | Requested quantity exceeds the remaining refundable quantity. |
| `SHOPIFY_AMOUNT_READBACK_REQUIRED`         | One or more Shopify allocation fields are absent.             |
| `SHOPIFY_AMOUNT_NOT_READ_BACK`             | Allocation source is not Shopify read-back.                   |
| `INVALID_SHOPIFY_AMOUNT_READBACK`          | Currency or amount shape is malformed.                        |
| `SHOPIFY_AMOUNT_IDENTITY_MISMATCH`         | Amount read-back targets another refund transaction.          |
| `COMPONENT_SUBTOTAL_MISMATCH`              | Component subtotal does not equal quantity times unit price.  |
| `SHOPIFY_AMOUNT_TOTAL_MISMATCH`            | Signed allocation contributions do not reconcile to total.    |
| `SHOPIFY_AMOUNT_TOTAL_OVERFLOW`            | A signed allocation intermediate total exceeds safe range.    |
| `SHOPIFY_CALCULATED_ACTUAL_MISMATCH`       | Calculated and actual read-backs differ.                      |
| `INVENTORY_EVIDENCE_REQUIRED`              | Inventory read-back is absent.                                |
| `INVALID_INVENTORY_EVIDENCE`               | Inventory evidence does not match schema types.               |
| `INVENTORY_IDENTITY_MISMATCH`              | Inventory evidence targets another Variant.                   |
| `INVENTORY_REFUND_IDENTITY_MISMATCH`       | Inventory evidence targets another refund or Order line.      |
| `COMPONENT_RESTOCK_MISMATCH`               | Component restock delta is not exact.                         |
| `COMPONENT_INVENTORY_READBACK_MISMATCH`    | Component before/after values do not prove the delta.         |
| `PARENT_INVENTORY_CHANGED`                 | Parent inventory delta is non-zero.                           |
| `PARENT_INVENTORY_READBACK_MISMATCH`       | Parent before/after values do not prove the zero delta.       |

## Local use

Import `assessPrebuiltPartialRefundAcceptance` from
`scripts/prebuilt-partial-refund-acceptance.js` and pass the parsed evidence
object. This V1 module has no CLI or apply mode.

Run the focused tests with:

```text
npm.cmd test -- prebuilt-partial-refund-acceptance.test.js
```
