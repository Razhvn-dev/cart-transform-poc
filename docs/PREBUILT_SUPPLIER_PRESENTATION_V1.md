# Pre-built Supplier Presentation V1

Status: local-only V5.5 read model under the locked V5.4 baseline.

This contract presents internal component Order truth as supplier-facing main
Kit SKU quantities. It does not edit an Order, replace component lines, update
inventory, call Shopify or Collective, or authorize fulfillment.

## API

```js
import { buildPrebuiltSupplierPresentation } from "../scripts/prebuilt-supplier-presentation.js";

const result = buildPrebuiltSupplierPresentation(input);
```

The input uses schema version `prebuilt_supplier_presentation.v1` and contains:

- one internal Order identity;
- immutable component-line evidence with Order line, component Variant, SKU,
  physical quantity, bundle-instance, supplier, and location identities;
- zero or more bundle-instance mappings to one main Kit SKU and one fulfillment
  identity;
- a mapping trace identifier for later reconciliation.

The structural input schema is
`docs/schemas/prebuilt-supplier-presentation.v1.schema.json`. JSON Schema alone
does not prove that a mapping is safe. The JavaScript evaluator is authoritative
for cross-record ambiguity, fulfillment agreement, aggregation, and trace.
Contract objects must be JSON-like plain objects whose required fields are own
properties; custom-prototype objects and class instances are invalid. Every
non-empty string field must contain at least one non-whitespace character.

## Read-model output

The result is deeply frozen and has:

- `status`: `ready`, `needs_review`, or `invalid`;
- `supplier_lines`: main Kit SKU, kit-instance quantity, and fulfillment
  identity only;
- `reconciliation_trace`: Order, bundle-instance, component-line, and mapping
  trace identifiers associated with each supplier line;
- `inventory_authority: "internal_component_order"`;
- `parent_inventory_authority: false`;
- `writes_performed: false`;
- deterministic `issues`.

The trace is internal reconciliation metadata. It must not be interpreted as a
supplier inventory instruction or as authority to deduct the parent Kit.

## Quantity and aggregation

Each unambiguous bundle instance contributes exactly one unit of its main Kit
SKU. Component physical quantities such as `x2`, `x4`, or `x8` remain unchanged
internal Order facts and are never summed into supplier Kit quantity.

Bundle instances aggregate only when all of these values match exactly:

1. `main_kit_sku`;
2. `fulfillment_identity.supplier_id`;
3. `fulfillment_identity.location_id`.

The same main Kit SKU assigned unambiguously to different fulfillment
identities produces separate supplier lines.

## Fail-closed review rules

A bundle instance is omitted from `supplier_lines` and the overall result is
`needs_review` when:

- no main Kit mapping exists;
- multiple mappings exist for that bundle instance;
- its component lines span suppliers;
- component-line fulfillment identities conflict;
- the mapping fulfillment identity does not exactly match the component Order;
- a mapping references no internal component Order bundle instance.

Valid bundle instances may still be presented alongside a review issue, but
`status: "needs_review"` means the complete result must not be treated as an
automatic fulfillment instruction.

Malformed Order identities, unsafe component quantities, invalid Variant GIDs,
a mapping record with a missing or blank main Kit SKU, missing trace identities,
non-plain objects, inherited required fields, and unknown fields return
`invalid` with no supplier lines. This differs from having no mapping record
for a bundle instance, which remains a reconciliation gap marked
`needs_review`.

## Authority boundary

Internal Checkout, Order, refund, and inventory truth stays component-level.
The main Kit SKU is a supplier presentation only. The parent is never inventory
authority, and this read model contains no Shopify transport or mutation path.
Real supplier/Collective behavior remains unverified until a separately
approved development-store Order and fulfillment acceptance window is run.
