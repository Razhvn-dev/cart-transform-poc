# Development Store Catalogue Import and Cleanup — 2026-07-21

## Scope and boundary

This record covers a development-store-only catalogue import and removal of obsolete
test records. The target was development app `cart-transform-poc-dev` on
`huang-mvqquz1p.myshopify.com`. It does not change the Custom Distribution App,
production, Cart Transform registration, Function deployment, runtime authority,
inventory, or bundle relationships.

## Import evidence

The operator imported the real catalogue export through Shopify Admin's official CSV
import flow using `products_export_1.csv`.

Shopify's import preview reported:

| Item | Count |
| --- | ---: |
| Products | 235 |
| SKUs reported by Shopify | 5,644 |
| Images | 5,182 |
| Markets | 1 |

The import completed successfully. A subsequent Admin API read confirmed a real
catalogue product, `High Roller Pro Ignition Package`, with 31 variants.

This import creates ordinary Shopify products and variants only. It does **not**
create Bundle Admin Definitions, revisions, runtime snapshots, Cart Transform
activation, component inventory deductions, or checkout/order expansion.

## Cleanup evidence

After the import, 23 obsolete development-only products were deleted deliberately:

- seven former `[ACES Pilot]` products;
- sixteen Shopify sample/snowboard products.

The six POC regression products were intentionally preserved:

```text
master-kit-test
efi-test
fuel-test
fuel-test-2
coil-test
prebuilt-bundle-test
```

Final read-back:

| Check | Result |
| --- | --- |
| Store product count | 241 |
| Obsolete cleanup candidates remaining | 0 |
| `master-kit-test` preserved | yes |
| `prebuilt-bundle-test` preserved | yes |
| Imported catalogue example exists | yes |

The deleted records can be restored only by a deliberate future import or recreation;
no production catalogue data was touched.

## Remaining implementation boundary

1. Local SKU/price mapping candidates are prepared for all 1,148 source Bundles
   whose component quantities are all one. The candidate report matched every
   parent and component SKU once in the imported CSV: zero missing and zero
   ambiguous identities. It is local-only and carries no Shopify GIDs or writes.
2. Review and explicitly bind the selected candidates to Shopify targets before any
   Bundle Admin Definition/revision generation. Do not infer product-series keys or
   activate a generic runtime from SKU matching alone.
3. Keep the 406 source Bundles containing `x2`, `x4`, or `x8` components blocked
   pending a V5.5-or-newer architecture decision.
4. Do not write full-catalogue Bundle Admin records or activate generic runtime
   expansion until the mapping review and separate approval are complete.
5. A storefront/order/inventory pilot still needs an approved product scope and
   acceptance evidence. The CSV import did not set a test inventory baseline.

Generated local mapping report:

```text
.local/dev-catalog-target-mapping-candidates-2026-07-21.json
```

The first verified real-catalogue demo candidate is documented in
`docs/DEV_REAL_BUNDLE_DEMO_CANDIDATE_2026-07-21.md`.
