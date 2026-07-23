# Rust Projection Development Integration Design

## Goal

Deploy the locally accepted Rust projection Function to only
`cart-transform-poc-dev` / `huang-mvqquz1p.myshopify.com`, preserve the
existing `master-kit-expand` Function identity and Cart Transform registration,
and stop at hosted Browser -> Cart -> Checkout validation.

## Constraints

- Preserve Option C and Bundle Metadata V1.
- Keep production and the Custom Distribution App untouched.
- Do not delete or recreate the Cart Transform registration.
- Keep active development version `cart-transform-poc-dev-64` as the verified
  rollback anchor until the Rust candidate is released.
- Do not commit or push this batch.
- Do not change product, inventory, metafield, or theme data during deployment.

## Chosen Architecture

Use an ignored local staging directory rather than exposing the sibling Rust
spike to normal Shopify CLI discovery. The staged Function manifest reuses the
existing production-safe Function UID and handle:

- UID: `67c62dc1-f689-b420-3491-32bd242a5a2d29f7d2c6`
- handle: `master-kit-expand`
- target: `purchase.cart-transform.run`

A dedicated development-only app config includes exactly the existing Theme App
Extension and the staged Rust Function. The normal `shopify.app.dev.toml` and
`shopify.app.toml` remain unchanged.

Deployment is two-phase:

1. Build and locally validate the Rust candidate.
2. Create an inactive app version with `shopify app deploy --no-release`.
3. Read back the version list and require the candidate to be inactive while
   v64 remains active.
4. Release the exact candidate version.
5. Read back the active version and Cart Transform binding. The registration ID
   and Function ID must remain unchanged and resolvable.

If any post-release binding assertion fails, release v64 immediately and read
back the active version and binding. No registration mutation is allowed.

## Components

- `scripts/rust-projection-dev-integration.js`: pure validation, version parsing,
  and staging-manifest/config rendering.
- `scripts/build-rust-projection-function.mjs`: load the Windows MSVC environment,
  build the original Rust crate, and copy the exact Wasm to staging.
- `scripts/deploy-dev-rust-projection.mjs`: fail-closed dry-run/execute
  orchestration, two-phase deploy/release, read-back, and v64 rollback.
- `.local/rust-projection-dev-integration/`: ignored generated staging output.

## Safety and Evidence

The deploy orchestrator must reject the wrong app name, Client ID, store,
baseline version, Function UID/handle, dirty generated production Function
artifact, or unresolved/multiple Cart Transform registrations. Dry-run is the
default. `--execute` is required for external writes.

The hosted acceptance target is the real ten-component
`AS2014B2-FK-4005P` bundle, followed by the twelve-component representative if
the first result passes. Inventory must use the existing exact CAS window and
must be restored before stopping. Browser checkout inspection remains a manual
validation boundary; no order is submitted and no customer/payment data is
entered.

## Rollback

Release `cart-transform-poc-dev-64`, then verify it is active and that the single
Cart Transform registration still resolves to Function
`019f5e8c-0374-7577-b756-66af47a751be`. Registration deletion/recreation is not
part of this design.
