# Pre-built Projection Rust Spike Design

Status: approved direction, pending written-spec review
Date: 2026-07-22
Scope: local and development-only feasibility work

## 1. Objective

Build an isolated Rust Cart Transform prototype that reproduces the existing
development-only pre-built projection expansion path with materially lower
Shopify Function instruction cost.

The spike succeeds only when it proves both functional parity and runtime
headroom for the existing 8-component fixture, the real 10-component
`AS2014B2-FK-4005P` fixture, and a 12-component boundary fixture.

## 2. Non-goals and locked boundaries

This work does not change the accepted business architecture:

- Option C remains locked.
- Cart keeps one Master Kit parent line.
- Checkout and Orders expand into component lines.
- Inventory deducts components only.
- `lineUpdate` remains prohibited.
- Runtime `productVariantComponents` remains prohibited.
- Bundle Metadata V1 remains unchanged.
- The projection publication format remains
  `prebuilt_bundle_expand_projection.v1` during the spike.
- The current JavaScript Function, development deployment v64, production
  entry, Custom Distribution App, theme, store products, metafields, and
  inventory are not modified by the local spike.

The spike is not permission to deploy, register a Cart Transform, commit,
push, or change production runtime authority. Each external action requires a
separate explicit approval after local evidence is reviewed.

## 3. Alternatives considered

### A. Parallel Rust prototype (selected)

Create a sibling Rust extension with Shopify CLI and keep it outside the
current Function profile/deployment path. Reuse the existing GraphQL input
contract and benchmark fixtures, then compare its output against the accepted
JavaScript result.

This has the strongest isolation and preserves v64 if the experiment fails.

### B. In-place rewrite of `master-kit-expand`

Replace the current JavaScript extension directly. This creates fewer files,
but mixes language migration with the mature Shared Core fallback and raises
rollback risk. It is rejected for the feasibility phase.

### C. Continue JavaScript micro-optimization

Further shorten data and validation paths. The real 10-component fixture is
still approximately 943,915 instructions over the 11,000,000 limit after the
latest hardening, so this route has insufficient evidence of reaching both
the 10- and 12-component targets. It is retained only as a fallback research
direction.

## 4. Proposed architecture

The prototype is a sibling extension named
`master-kit-expand-rust-spike`, generated with Shopify CLI's Rust Cart
Transform template. It is local-only and is not added to an approved deploy
profile during the spike.

The prototype contains four focused units:

1. GraphQL input query: fetches the same cart-line identity, price, Bundle
   Metadata V1 attributes, parent product/variant IDs, and
   `aces_dev.prebuilt_bundle_expand_projection_v1` `jsonValue` used by the
   current development candidate.
2. Projection data model: deserializes the existing projection JSON without
   introducing a second schema or changing publication data.
3. Validator and expander: validates the parent binding, metadata, component
   shape, duplicate bundle instance, and exact component-price sum before
   emitting a Cart Transform expand operation.
4. Local parity and budget harness: runs identical fixtures through the Rust
   Function, compares normalized output with the accepted JavaScript output,
   and records Shopify CLI instruction counts.

The initial spike optimizes the dominant single-parent pre-built cart path.
Multiple qualifying parents must still be deterministic and reject duplicate
`_bundle_id` values. Non-projection lines and invalid projection inputs return
no Rust operation; they do not silently invent component data.

## 5. Data flow

1. Shopify supplies the cart line and product projection metafield through the
   Function input query.
2. Rust checks that the line is a ProductVariant and that Bundle Metadata V1
   is complete.
3. Rust deserializes `prebuilt_bundle_expand_projection.v1`.
4. Rust confirms projection parent product and variant IDs match the cart
   merchandise.
5. Rust confirms each component is valid and the fixed component prices sum
   exactly to the parent line price in integer cents.
6. Rust emits one expand operation whose component ordering, quantities,
   prices, and ten line attributes match the accepted JavaScript output.
7. Any failed precondition returns an empty operation list.

The spike does not query or derive runtime component relationships from
Shopify productVariantComponents. All component authority remains in the
published projection.

## 6. Error handling and safety

- Missing metafield, malformed JSON, unsupported schema version, mismatched
  parent binding, invalid decimal, wrong component total, empty components,
  duplicate sequence, duplicate component variant, or duplicate bundle
  instance fails closed with `operations: []`.
- The Function performs no network, filesystem, clock, or random access.
- Output fields are produced only from validated projection data and accepted
  Bundle Metadata V1 cart attributes.
- The JavaScript v64 path remains the recovery baseline throughout the spike.
- Rust build artifacts and generated files remain isolated from the existing
  production-clean assertion until an integration design is separately
  approved.

## 7. Testing strategy

Implementation follows test-first development:

1. Capture the accepted JavaScript output for the 8-component, real
   10-component, and 12-component fixtures.
2. Add failing Rust tests for valid expansion and the fail-closed cases before
   implementing the corresponding behavior.
3. Build the Rust Function with Shopify CLI.
4. Run the same JSON fixtures with `shopify app function run`.
5. Compare normalized Rust and JavaScript outputs exactly.
6. Record instruction cost for all three benchmark fixtures.
7. Re-run the existing JavaScript tests and production-clean assertion to
   prove isolation.

## 8. Acceptance criteria

The spike is locally successful only if all conditions are true:

- 8-component output equals the accepted JavaScript output.
- Real 10-component `AS2014B2-FK-4005P` output equals the accepted JavaScript
  output and executes below 11,000,000 instructions.
- 12-component output equals the accepted JavaScript output and executes below
  11,000,000 instructions.
- The target engineering threshold is at most 8,800,000 instructions for the
  real 10-component and 12-component fixtures, providing at least 20% headroom;
  results between 8,800,001 and 11,000,000 are technically valid but require a
  risk review before any hosted test.
- Invalid and mismatched inputs return no operations.
- Existing JavaScript tests, build, lint, local validation, production-clean
  assertion, and `git diff --check` remain successful.
- No Shopify deployment or store mutation occurs.

## 9. Decision after the spike

- If parity and the 20% headroom target pass, prepare a separate development
  integration design and request approval for a dev-only deployment test.
- If parity passes but headroom is below 20%, profile the dominant Rust costs
  and decide whether one bounded optimization cycle is justified.
- If the hard 11,000,000 limit fails, keep v64 active and evaluate projection
  schema compaction or a product-scope split without changing Option C.

No result from this spike directly authorizes production migration.
