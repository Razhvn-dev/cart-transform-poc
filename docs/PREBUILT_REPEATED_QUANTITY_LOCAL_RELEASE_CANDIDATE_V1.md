# Pre-built Repeated Quantity Local Release Candidate V1

Status: local release candidate ready; no Shopify deployment or write has been
performed.

Date: 2026-07-24

## Scope completed

- Repeated component quantities use physical-unit counts and per-unit prices.
- Duplicate component Variants are aggregated safely and deterministically.
- V2 projection publication evidence binds the complete projection and audit
  provenance.
- JavaScript and Rust Function candidates accept V1 and V2 without changing the
  production profile.
- One component or one unit can be reconciled for partial refund, including
  amount, transaction, order, bundle, and inventory identity evidence.
- Supplier presentation exposes the main Kit SKU while internal Checkout,
  Order, and inventory authority remains component-level.

## Local verification

- Full repository test suite: 1,001 tests passed.
- Function test suite in `validate:local`: 503 tests passed.
- Rust test suite: 39 tests passed.
- JavaScript/Rust shared-core parity: 11 cases passed.
- `validate:local`: passed, including lint, app build, production/dev typegen,
  production/dev Function builds, and production-clean assertion.
- Rust instruction-budget gate: passed for the documented conservative envelope
  of one cart line with up to 19 components. Larger boundary probes remain
  explicitly outside that supported envelope.
- `git diff --check`: passed; only line-ending warnings were reported.

## Runtime and release boundary

- V5.4 remains the locked SSOT.
- The last confirmed development runtime baseline remains v64; this local batch
  did not re-read or mutate Shopify live state.
- No commit, push, Function deployment, activation, registration change, product
  write, inventory write, order, refund, or production action was performed.

## Manual/external UAT gate

The next phase requires explicit development-store writes and manual evidence:

1. Publish an inactive candidate only to `cart-transform-poc-dev` on
   `huang-mvqquz1p.myshopify.com`, then read back the version and binding before
   activation.
2. Validate Cart, Checkout, and Order for component quantities x2, x4, and x8,
   including per-unit prices and component inventory deductions.
3. Refund one unit and verify the exact refund amount and one-unit inventory
   restoration.
4. Validate that supplier/Collective presentation shows the main Kit SKU while
   internal component accounting remains intact.
5. Reconfirm the v64 rollback path and run a fresh Cart/Checkout smoke after
   rollback.

Until that gate is authorized and executed, this candidate is locally verified
but not Shopify-hosted verified.
