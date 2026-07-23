# Rust Projection Development Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely package, deploy, and read back the Rust projection Function on the development app while preserving the existing Function and Cart Transform identity.

**Architecture:** Generate an ignored staging extension that reuses the existing Function UID/handle, deploy it first as an inactive app version, then release and verify it. Retain v64 as the exact rollback anchor and prohibit Cart Transform registration mutation.

**Tech Stack:** Node.js ESM, Vitest, Rust stable, Shopify Functions Rust 2.x, Shopify CLI 4.5.2, Admin GraphQL 2026-04.

## Global Constraints

- Target only `cart-transform-poc-dev` / `huang-mvqquz1p.myshopify.com` / `shopify.app.dev.toml`.
- Preserve Option C, Bundle Metadata V1, Function UID, Function handle, and registration.
- Do not touch production, Custom Distribution App, product, inventory, metafield, or theme state during deployment.
- Do not commit or push.
- Deployment must default to dry-run and require `--execute`.

---

### Task 1: Pure integration contract

**Files:**
- Create: `scripts/rust-projection-dev-integration.js`
- Create: `scripts/rust-projection-dev-integration.test.js`

**Interfaces:**
- Produces: `TARGET`, `assertDeploymentIdentity`, `findVersion`,
  `assertInactiveCandidate`, `assertActiveCandidate`, `renderStagingManifest`,
  and `renderStagingAppConfig`.

- [ ] Write failing tests for the exact development identity, v64 baseline,
  inactive candidate, active candidate, Function UID/handle, and generated
  extension directory isolation.
- [ ] Run `npx vitest run scripts/rust-projection-dev-integration.test.js` and
  verify failure because the module does not exist.
- [ ] Implement the minimum pure helpers and exact constants.
- [ ] Re-run the focused test and require all cases to pass.

### Task 2: Guarded Rust build and staging

**Files:**
- Create: `scripts/build-rust-projection-function.mjs`
- Create: `scripts/stage-rust-projection-dev-integration.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: renderers from Task 1 and the source crate at
  `extensions/master-kit-expand-rust-spike`.
- Produces: `.local/rust-projection-dev-integration/extensions/master-kit-expand/dist/index.wasm`
  plus an isolated app config.

- [ ] Add `.local/` staging assertions to the focused tests and verify red.
- [ ] Implement MSVC environment discovery with `vswhere`/`vcvars64.bat`, run
  `cargo build --target wasm32-unknown-unknown --release`, and copy the Wasm.
- [ ] Generate a staged manifest using UID
  `67c62dc1-f689-b420-3491-32bd242a5a2d29f7d2c6`, handle
  `master-kit-expand`, and the unchanged `src/run.graphql`.
- [ ] Generate an ignored development config with extension directories limited
  to `extensions/product-builder` and the staged Rust Function.
- [ ] Run the focused tests, staging command, `shopify app info` against the
  staged config, and assert exactly one Function plus the Theme App Extension.

### Task 3: Fail-closed two-phase deployment orchestrator

**Files:**
- Create: `scripts/deploy-dev-rust-projection.mjs`
- Modify: `package.json`
- Test: `scripts/rust-projection-dev-integration.test.js`

**Interfaces:**
- Consumes: Task 1 contract and Task 2 staging output.
- Produces: dry-run evidence or an inactive candidate followed by an explicitly
  released and read-back Rust development version.

- [ ] Write failing tests for dry-run default, missing `--execute`, wrong active
  baseline, multiple registrations, changed registration ID/Function ID, and
  rollback command selection.
- [ ] Implement read-only preflight: app info, active version v64, one resolving
  registration, production-clean assertion, Rust tests, parity/budget gate, and
  staged app validation.
- [ ] Implement `--execute`: deploy with `--no-release`, read back the exact
  inactive version, release it, then read back active version and binding.
- [ ] Implement automatic v64 release/read-back if the post-release binding
  assertion fails. Never call Cart Transform create/delete.
- [ ] Run focused tests and a real dry-run; inspect every printed target and
  planned mutation.

### Task 4: Development-only release and read-back

**Files:**
- Modify: `docs/DEV_CATALOG_TECHNICAL_BATCH_3_2026-07-22.md`

**Interfaces:**
- Consumes: successful Task 3 dry-run and the user's standing development-only
  authorization.
- Produces: a new active Rust development version or verified v64 rollback.

- [ ] Re-run `cargo test`, the Rust parity/budget gate, repository tests,
  Function tests, lint, build, local validation, production-clean, and
  `git diff --check`.
- [ ] Execute the guarded deployment command with `--execute`.
- [ ] Read back the active version, exact Function ID, registration ID, and
  `allRegistrationsResolve=true`.
- [ ] Record version IDs, messages, binding evidence, and whether rollback ran.

### Task 5: Hosted breadth acceptance boundary

**Files:**
- Modify: `docs/DEV_CATALOG_TECHNICAL_BATCH_3_2026-07-22.md`
- Modify: `docs/PROJECT_BUSINESS_PROGRESS_2026-07-21.md`

**Interfaces:**
- Consumes: active verified Rust development version.
- Produces: a precise manual Browser -> Cart -> Checkout validation request.

- [ ] Read back the ten- and twelve-component catalogue/projection identities.
- [ ] Prepare but do not open inventory until the manual validation session is
  ready.
- [ ] Stop and ask Huang to perform or authorize the required interactive hosted
  checkout observation if the browser session cannot be completed safely by the
  agent.
- [ ] Restore any opened inventory window with CAS/read-back before completion.
- [ ] Record verified results separately from unverified/manual observations.
