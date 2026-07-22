# Development Catalogue Technical Batch V1 — 2026-07-21

## Scope

This is an explicit technical acceptance batch, not a business product-series
assignment. It contains three quantity-one parent SKUs:

- `AD2011-C`
- `AD2023-C`
- `AF4005PK`

The scope is stored in
`docs/examples/dev-catalog-technical-batch.quantity-one-v1.json`. The audit refuses
a `product_series_key` field so catalogue naming cannot silently become business
authority.

## Local dry-run evidence

The read-only audit against the 1,148-candidate local catalogue report produced
checksum `045b7516` with no blocked records:

| Parent | Components | Parent | Component subtotal | Allocated component prices |
| --- | ---: | ---: | ---: | --- |
| `AD2011-C` | 2 | `$369.99` | `$379.98` | `AD2011 $321.31`; `AC2008 $48.68` |
| `AD2023-C` | 2 | `$389.99` | `$419.98` | `AD2023 $343.57`; `AC2008 $46.42` |
| `AF4005PK` | 2 | `$559.99` | `$589.98` | `AF4005P $446.10`; `AF2009P $113.89` |

Every allocation preserves the exact parent total. No Shopify write is available
from the audit command.

## Development-store read-back

Target was limited to development app `cart-transform-poc-dev`, store
`huang-mvqquz1p.myshopify.com`, config `shopify.app.dev.toml`, Admin API `2026-04`.

- All requested parent and component SKUs resolved exactly once.
- All resolved products are `ACTIVE`.
- Every live Variant price equals the local catalogue price.
- Parent Variant IDs:
  - `AD2011-C`: `gid://shopify/ProductVariant/51592633811222`
  - `AD2023-C`: `gid://shopify/ProductVariant/51592633647382`
  - `AF4005PK`: `gid://shopify/ProductVariant/51592671789334`
- All three parent products currently return no `onlineStoreUrl`; this is a
  storefront-publication review item, not an identity or pricing blocker.
- The read-back performed no Shopify writes.

Local evidence files are intentionally ignored under `.local/`:

- `.local/dev-catalog-technical-batch-readiness-2026-07-21.json`
- `.local/dev-catalog-technical-batch-live-readback-2026-07-21.json`

## Next boundary

1. Generate deterministic Bundle Config/Definition/Revision draft packages for
   `AD2011-C` and `AD2023-C`, while treating the already verified `AF4005PK`
   Definition as an existing binding.
2. Keep those packages local until their explicit development product-series scope,
   collision read-back, and publication evidence all pass.
3. Only then persist the new development Definitions/Revisions/Projections and add
   the two parent SKUs to the isolated Theme block acceptance scope.
4. Browser acceptance must still prove Cart parent lines, Checkout component lines,
   exact totals, Order component lines, and component-only inventory deduction.

Production runtime authority, Custom Distribution App, inventory, Theme state, and
existing Bundle Admin resources were not changed in this batch.

## Local draft and import review

The two new parents now have deterministic, locally validated drafts:

| Parent | Proposed Definition | Proposed Revision | Snapshot preview |
| --- | --- | --- | --- |
| `AD2011-C` | `36d5b724-8d8b-57b0-83a6-cf74e37ea223` | `b9215726-c946-5181-84bb-74724bb38bf5` | `639a025a` |
| `AD2023-C` | `4e27404d-877b-5b4f-9f9e-e8836115ace3` | `638377b3-83a4-5785-a3bd-9e4e59bead1e` | `1188e8dc` |

`AF4005PK` is explicitly classified as an existing binding and is not included in
the new import package. Read-only pagination scanned all six development
BundleDefinitions: both proposed Definition IDs and parent Variants are collision
free, while the AF4005PK parent has exactly one expected existing owner.

For development acceptance only, `AD2011-C` and `AD2023-C` are explicitly assigned
to `dev-distributor-coil-bundle-acceptance`. This is not a production catalogue
taxonomy decision.

The corrected generated `prebuilt_bundle_import_package.v1` has fingerprint `fd1baf03`.
Its dry-run contains two `ready_for_confirmation` records, zero review records,
zero rejected records, and confirmation token `dbb32b79`. The import review promotes
the local draft configuration to `active` and stamps publication audit fields before
compiling a published target; it never carries `configuration.status=draft` into a
published Revision. The package, plan, draft,
and collision reports remain ignored `.local/` evidence and performed no writes.

## Frozen development execution manifest

The local execution manifest checksum is `70a50d1f`. It is bound to development app
`cart-transform-poc-dev`, config `shopify.app.dev.toml`, store
`huang-mvqquz1p.myshopify.com`, and exact apply phrase
`APPLY_DEV_BATCH_dbb32b79`.

| Parent | Publication | Snapshot | Projection |
| --- | --- | --- | --- |
| `AD2011-C` | `7cf2d130-b520-5db2-aa32-4e06bee37fa9` | `639a025a` | `850c67b4` |
| `AD2023-C` | `b32666a3-0ee7-5e05-85dc-875fa56d6e08` | `1188e8dc` | `7941ca33` |

Each record has nine ordered boundaries from ledger pending CAS through durable
publication read-back and ledger completion. Its retry policy is
`RECONCILE_THEN_EXACT_RESUME`; a mutation transport error must never be blindly
retried. Manifest preparation cannot accept Shopify mutation flags and performed no
remote writes.

## Recoverable executor and 2026-07-22 live completion

The development-only executor is implemented in
`scripts/execute-dev-catalog-technical-batch.mjs`. It validates manifest checksum
`70a50d1f`, the locked app/store/config, the reviewed package fingerprint, and the
exact apply phrase before any mutation. It writes one record at a time, leaves an
ambiguous failure in `pending`, and requires read-only reconciliation before an
exact resume. Tests cover first apply, idempotent completion, partial-write recovery,
fresh reconciliation evidence, and missing-confirmation refusal.

Both records are now durably complete. TLS failures interrupted the initial
`AD2011-C` transport, but a batched read-only reconciliation identified the exact
partial state and the executor resumed only the missing boundaries. `AD2023-C` then
completed through the same ledger-controlled path. No mutation with an ambiguous
transport result was blindly retried.

| Parent | Definition | Revision | Projection | Publication | Ledger |
| --- | --- | --- | --- | --- | --- |
| `AD2011-C` | active | published | `850c67b4` | `success` | `completed` |
| `AD2023-C` | active | published | `7941ca33` | `success` | `completed` |

## Storefront acceptance

The default development product template now contains three isolated app-block
bindings: `AF4005PK`, `AD2011-C`, and `AD2023-C`. The two new product pages emitted
the exact Metadata V1 parent identity and hydrated all six hidden cart properties.

- `AD2011-C`: native Cart contained one parent at `$369.99`; Checkout expanded
  `AD2011` and `AC2008`; test order confirmation `ZUADTNN5E` preserved the exact
  total and proved component-only inventory deduction.
- `AD2023-C`: native Add to cart produced one parent at `$389.99`; Checkout expanded
  `AD2023` and `AC2008` with quantity 1 each and preserved the exact total.
- The first AD2023 Checkout showed stock-problems with zeroed display quantities
  because component `AD2023` had no available inventory. A controlled 0-to-1
  component inventory window removed the stock problem and proved that the
  Projection itself was correct. No second order was created.
- Temporary parent/component inventory was restored with CAS mutations and exact
  read-back. The development cart was cleared after acceptance.

Production runtime authority, the Custom Distribution App, and production store
data were not changed by this batch.
