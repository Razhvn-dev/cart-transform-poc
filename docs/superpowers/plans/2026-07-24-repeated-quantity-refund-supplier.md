# Repeated Quantity, Partial Refund, and Supplier Presentation Implementation Plan

> **For agentic workers:** Use test-driven development for every behavior change,
> and use verification-before-completion before reporting a phase complete.

**Goal:** Implement the confirmed repeated-quantity, individual-unit refund, and
supplier main-SKU rules as additive V2 capabilities while preserving Option C,
the V5.4 baseline, and the active v64 runtime.

**Architecture:** Add V2 import and projection contracts for physical component
quantity and per-unit price. Feed the same validated projection into the JS and
Rust development candidates. Build refunds and supplier presentation as
separate, read-only reconciliation layers over component-level Order truth.

**Tech Stack:** JavaScript, Vitest, Rust stable, Shopify Cart Transform
development candidates, JSON Schema, local evidence checkers.

## Global Constraints

- Do not change the V5.4 SSOT or production runtime authority.
- Do not deploy, activate, commit, push, seed, or write to Shopify without
  Huang's separate explicit approval.
- Keep v64 active throughout local work.
- Preserve V1 contracts and evidence; V2 changes are additive.
- Keep one quantity-one parent Cart line per bundle instance.
- Keep internal Checkout, Order, and inventory authority component-level.
- Do not migrate the 406 repeated-quantity records during local implementation.

## Phase A — Repeated Quantity Core

### Task 1: Define and normalize the V2 component contract

**Files:**

- Create:
  `extensions/master-kit-expand/src/config/prebuilt-bundle-import.quantity-v2.js`
- Create:
  `extensions/master-kit-expand/src/config/prebuilt-bundle-import.quantity-v2.test.js`

**Steps:**

1. Write failing tests for `x2`, `x4`, and `x8`, invalid numeric forms,
   duplicate Variant aggregation, source identity preservation, and unsafe
   integer rejection.
2. Run:
   `npm test -- prebuilt-bundle-import.quantity-v2.test.js`
   and confirm the new behavior is red.
3. Implement the smallest normalizer that returns one record per unique
   component Variant with `quantity` in `1..2,147,483,647` and per-unit price.
4. Reject conflicts where duplicate records for one Variant disagree on unit
   price or source identity.
5. Re-run the focused test and confirm it is green.

### Task 2: Compile and validate a V2 expand projection

**Files:**

- Create:
  `extensions/master-kit-expand/src/config/prebuilt-bundle-expand-projection-v2.js`
- Create:
  `extensions/master-kit-expand/src/config/prebuilt-bundle-expand-projection-v2.test.js`
- Reference:
  `extensions/master-kit-expand/src/config/prebuilt-bundle-expand-projection.js`

**Steps:**

1. Write failing tests proving that every projected component contains
   `variantId`, `quantity`, and `fixedPricePerUnit`.
2. Add failure tests for duplicate Variants, invalid quantities, overflow,
   unsupported price precision, and parent-total mismatch.
3. Implement minor-unit price multiplication:
   `sum(quantity * fixedPricePerUnit)`.
4. Include V2 contract identity in projection checksum/fingerprint input.
5. Run:
   `npm test -- prebuilt-bundle-expand-projection-v2.test.js`.

### Task 3: Add quantity to the isolated JS Function candidate

**Files:**

- Modify:
  `extensions/master-kit-expand/src/config/prebuilt-bundle-projection.function-candidate.js`
- Modify:
  `extensions/master-kit-expand/src/config/prebuilt-bundle-projection.function-candidate.test.js`
- Verify:
  `extensions/master-kit-expand/src/config/bundle-runtime.entry-isolation.test.js`

**Steps:**

1. Add failing candidate tests for `x2/x4/x8`, mixed quantities, and multiple
   independent bundle instances.
2. Make V2 components emit their physical quantity while retaining V1
   quantity-one compatibility inside the isolated development candidate.
3. Calculate the candidate total with quantity multiplication.
4. Confirm production entrypoints still cannot import the development
   candidate.
5. Run:
   `npm test -- prebuilt-bundle-projection.function-candidate.test.js bundle-runtime.entry-isolation.test.js`.

### Task 4: Add Rust stable quantity support and JS/Rust parity

**Files:**

- Modify:
  `extensions/master-kit-expand-rust-spike/src/run.rs`
- Modify the existing Rust spike fixtures/tests under:
  `extensions/master-kit-expand-rust-spike`
- Modify or create the existing JS/Rust parity fixture for V2 quantity.

**Steps:**

1. Add failing Rust tests for physical quantities and per-unit price
   multiplication.
2. Extend the Rust projection component with a validated positive quantity.
3. Emit one expanded component line per unique Variant with that quantity.
4. Use checked arithmetic for quantity and price totals.
5. Add parity fixtures for `x2`, `x4`, `x8`, mixed quantities, invalid
   quantities, and overflow.
6. Run:
   `cargo test --manifest-path extensions/master-kit-expand-rust-spike/Cargo.toml`,
   then the existing JS/Rust parity and budget commands documented by the
   spike.
7. Record artifact size and instruction-cost results without activating any
   hosted version.

### Task 5: Add V2 publication and acceptance evidence

**Files:**

- Create:
  `extensions/master-kit-expand/src/config/prebuilt-projection-publication-evidence-v2.js`
- Create:
  `extensions/master-kit-expand/src/config/prebuilt-projection-publication-evidence-v2.test.js`
- Create:
  `docs/schemas/prebuilt-bundle-pilot-acceptance.v2.schema.json`
- Create:
  `scripts/prebuilt-bundle-pilot-acceptance-v2.js`
- Create:
  `scripts/prebuilt-bundle-pilot-acceptance-v2.test.js`
- Reference:
  `extensions/master-kit-expand/src/config/prebuilt-projection-publication-evidence.js`
- Reference:
  `scripts/prebuilt-bundle-pilot-acceptance.js`

**Steps:**

1. Write failing tests requiring exact component quantities, per-unit prices,
   parent total, parent inventory delta zero, and component inventory deltas.
2. Add V2 schema fields without changing V1 evidence interpretation.
3. Make all missing or inconsistent quantity evidence fail closed.
4. Run the focused V2 publication and acceptance tests.
5. Run the complete local JavaScript test suite and production-clean
   assertions.

## Phase B — Partial Refund Reconciliation

### Task 6: Implement a read-only partial-refund acceptance contract

**Files:**

- Create: `scripts/prebuilt-partial-refund-acceptance.js`
- Create: `scripts/prebuilt-partial-refund-acceptance.test.js`
- Create: `docs/schemas/prebuilt-partial-refund-acceptance.v1.schema.json`
- Create: `docs/PREBUILT_PARTIAL_REFUND_ACCEPTANCE_V1.md`

**Steps:**

1. Write failing tests for refunding one of `N`, refunding several units, full
   remaining quantity, duplicate refund evidence, and over-refund.
2. Require evidence for Order component identity, ordered quantity, already
   refunded quantity, requested refund quantity, Shopify-calculated amount, and
   inventory-restock delta.
3. Verify exact component restoration and parent inventory delta zero.
4. Treat discount, tax, shipping, and rounding values as Shopify read-back
   evidence; do not locally invent allocations.
5. Return `passed`, `incomplete`, `failed`, or `invalid` with deterministic
   issue codes.
6. Run:
   `npm test -- prebuilt-partial-refund-acceptance.test.js`.

## Phase C — Supplier Main-SKU Presentation

### Task 7: Implement the supplier presentation read model

**Files:**

- Create: `scripts/prebuilt-supplier-presentation.js`
- Create: `scripts/prebuilt-supplier-presentation.test.js`
- Create: `docs/schemas/prebuilt-supplier-presentation.v1.schema.json`
- Create: `docs/PREBUILT_SUPPLIER_PRESENTATION_V1.md`

**Steps:**

1. Write failing tests where an internal component Order maps to exactly one
   supplier-facing main Kit SKU per bundle instance.
2. Prove the output does not replace or mutate internal component lines.
3. Aggregate supplier quantity only when main SKU and fulfillment identity are
   unambiguous.
4. Mark missing, conflicting, or cross-supplier mappings as `needs_review`.
5. Include trace identifiers sufficient for reconciliation without treating
   the parent as inventory authority.
6. Run:
   `npm test -- prebuilt-supplier-presentation.test.js`.

## Phase D — Local Release-Candidate Verification

### Task 8: Run the complete local gate

**Files:**

- Update the relevant local readiness report after evidence exists.
- Do not update the V5.4 SSOT.

**Steps:**

1. Run all focused V2, refund, supplier, isolation, and parity tests.
2. Run the repository's full test, lint, build, production-clean, and Rust
   stable verification commands.
3. Verify current production entry/query remains free of development tokens.
4. Verify no deployment configuration or active-version assumption changed.
5. Produce a local release-candidate report that separates:
   implemented behavior, locally verified behavior, and Shopify-unverified
   behavior.

## Phase E — Development-store UAT (Separate Approval Required)

### Task 9: Validate real Orders, refunds, inventory, and supplier behavior

**Target when approved:**

- App: `cart-transform-poc-dev`
- Store: `huang-mvqquz1p.myshopify.com`
- Baseline runtime: v64

**Required sequence:**

1. Confirm active version, Function extension, registration, and rollback
   target using read-only evidence.
2. Build and deploy an inactive development-only candidate.
3. Activate only inside the approved test window.
4. Manually validate Cart and Checkout for `x2`, `x4`, `x8`, mixed quantities,
   and multiple bundle instances.
5. Create approved development orders and record component-only Order lines
   plus exact inventory deltas.
6. Refund one unit from a repeated component and verify amount allocation and
   exact one-unit restock.
7. Validate the supplier/Collective main-Kit-SKU presentation with the
   responsible external party.
8. Restore inventory windows and reactivate v64 unless Huang separately
   approves another final state.
9. Read back active/inactive versions and document the final state.

This phase is a future external-write gate. The local implementation phases do
not authorize any of its actions.

## Recommended Execution Order

Execute Tasks 1–5 first because repeated quantity is the shared data foundation.
Then execute Tasks 6 and 7 independently, followed by the complete local gate
in Task 8. Stop before Task 9 and request the specific development-store write
approval and human Checkout/refund validation window.
