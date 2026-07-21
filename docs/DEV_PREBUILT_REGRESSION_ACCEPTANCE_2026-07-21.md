# Development Pre-built Regression Acceptance - 2026-07-21

Status: passed for the isolated development-store regression sample. This is not
a production release and it is not a full-catalogue migration approval.

## Scope

- Development app: `cart-transform-poc-dev`
- Development store: `huang-mvqquz1p.myshopify.com`
- Parent test SKU: `prebuilt-bundle-test`
- Parent Variant: `gid://shopify/ProductVariant/51571819708694`
- Function registration: `gid://shopify/CartTransform/136675606`

## Verified acceptance evidence

One customer order of the parent bundle was completed in the development store.

| Stage | Observed result |
| --- | --- |
| Cart | One parent line only, with Bundle Metadata V1. No component cart lines. |
| Checkout | Parent line expanded into exactly three components; displayed total remained USD 100.00. |
| Order Admin | Order #1013 contained only the three component lines at USD 50.00, USD 30.00, and USD 20.00. The parent line was absent. |
| Inventory | Each component changed from 10 to 9. Parent inventory did not change. |

The three development component variants were:

- `gid://shopify/ProductVariant/51592671756566` (`AF4005P`)
- `gid://shopify/ProductVariant/51592717566230` (`AF2009P`)
- `gid://shopify/ProductVariant/51592730706198` (`AC2008`)

This verifies the V5.4 Option C behavior for the isolated development sample:
one parent in cart, component expansion at Checkout and Order Admin, and
component-only inventory deduction.

## Real-catalogue next boundary

The first real-catalogue candidate is `AF4005PK`, with source checksum
`ba22188e`. The full Bundles.app workbook and imported Shopify catalogue resolve
it deterministically to parent SKU `AF4005PK` and components `AF4005P x1` and
`AF2009P x1`.

Before this real relationship can be activated, the project must create and review
a dedicated target mapping, component price allocation, and controlled Runtime
Snapshot promotion evidence. The passed regression sample does not itself publish
or activate `AF4005PK`, and it does not authorize a bulk import, production change,
or Custom Distribution App operation.
