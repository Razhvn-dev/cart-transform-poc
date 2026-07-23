# Pre-built Projection Rust Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that an isolated Rust Cart Transform can reproduce the accepted pre-built projection expansion output for 8, real 10, and 12 components while staying below Shopify's 11,000,000-instruction limit.

**Architecture:** Generate a sibling Rust Cart Transform extension with Shopify CLI and leave the existing JavaScript extension and deployed development v64 unchanged. The Rust extension consumes the existing `prebuilt_bundle_expand_projection.v1` metafield and Bundle Metadata V1 attributes, fails closed on invalid inputs, and is exercised by a local parity-and-budget harness using the same fixtures as the JavaScript candidate.

**Tech Stack:** Shopify CLI 4.5.0, Shopify Functions API 2026-04, Rust, `shopify_function`, Node.js 24, Vitest, Shopify CLI Function runner.

## Global Constraints

- Preserve Option C, one parent in Cart, expanded components in Checkout and Orders, and component-only inventory.
- Do not use `lineUpdate` or runtime `productVariantComponents`.
- Preserve Bundle Metadata V1 and `prebuilt_bundle_expand_projection.v1`.
- Target only `cart-transform-poc-dev` through `shopify.app.dev.toml` for CLI generation; do not deploy.
- Do not modify the Custom Distribution App, production Function authority, theme, products, inventory, metafields, or Cart Transform registration.
- Keep development v64 active and recoverable.
- Follow test-first development: every handwritten behavior test must fail for the expected reason before implementation.
- Do not commit or push without Huang's separate explicit approval; commit commands below define review checkpoints only.

---

## File map

- `extensions/master-kit-expand-rust-spike/`: CLI-generated, local-only Rust Function prototype.
- `extensions/master-kit-expand-rust-spike/src/run.graphql`: input contract matching the development projection candidate.
- `extensions/master-kit-expand-rust-spike/src/main.rs`: Shopify type generation and executable entry point.
- `extensions/master-kit-expand-rust-spike/src/run.rs`: projection model, validation, and expand operation.
- `extensions/master-kit-expand-rust-spike/tests/fixtures/*.json`: stable runner inputs for valid and invalid cases.
- `scripts/prebuilt-projection-benchmark-fixtures.mjs`: one authority for 8, real 10, and 12 fixture construction.
- `scripts/prebuilt-projection-rust-spike-result.js`: pure parity and threshold checks.
- `scripts/prebuilt-projection-rust-spike-result.test.js`: unit tests for result comparison and gate reporting.
- `scripts/check-prebuilt-projection-rust-spike.mjs`: build, run, compare, measure, and restore harness.
- `scripts/check-prebuilt-projection-function-budget.mjs`: imports shared fixtures instead of owning duplicate builders.
- `package.json`: exposes the Rust spike check command.
- `docs/DEV_CATALOG_TECHNICAL_BATCH_3_2026-07-22.md`: records measured evidence and the next decision.

### Task 1: Install and verify the isolated Rust toolchain

**Files:**
- Modify: none

**Interfaces:**
- Consumes: Windows package manager and Shopify CLI 4.5.0.
- Produces: `rustc`, `cargo`, `rustup`, and the `wasm32-wasip1` target available to Shopify CLI.

- [ ] **Step 1: Capture the missing-toolchain baseline**

Run:

```powershell
Get-Command rustc -ErrorAction SilentlyContinue
Get-Command cargo -ErrorAction SilentlyContinue
```

Expected: both commands produce no path before installation.

- [ ] **Step 2: Install Rustup without changing repository files**

Run:

```powershell
winget install --id Rustlang.Rustup --exact --accept-package-agreements --accept-source-agreements
```

Expected: Rustup installation succeeds. Start a new PowerShell process or prepend `%USERPROFILE%\.cargo\bin` to the task-local `PATH` if the current shell does not refresh automatically.

- [ ] **Step 3: Install the WASI compilation target**

Run:

```powershell
rustup default stable
rustup target add wasm32-wasip1
```

Expected: stable toolchain and `wasm32-wasip1` are installed.

- [ ] **Step 4: Verify versions and targets**

Run:

```powershell
rustc --version
cargo --version
rustup target list --installed
```

Expected: `rustc` and `cargo` report versions and the target list contains `wasm32-wasip1`.

- [ ] **Step 5: Record the checkpoint without committing**

Run:

```powershell
git status --short
```

Expected: installing the toolchain adds no repository changes.

### Task 2: Generate a sibling Rust Cart Transform extension safely

**Files:**
- Create: `extensions/master-kit-expand-rust-spike/**` through Shopify CLI
- Modify: `extensions/master-kit-expand-rust-spike/shopify.extension.toml`
- Modify: `extensions/master-kit-expand-rust-spike/src/run.graphql`

**Interfaces:**
- Consumes: development app config `shopify.app.dev.toml` and the existing API 2026-04 schema.
- Produces: a buildable Rust extension with target `purchase.cart-transform.run`, export `run`, and no deployment profile integration.

- [ ] **Step 1: Confirm the target identity before generation**

Run:

```powershell
$env:SHOPIFY_CLI_AGENT_INFO='n:codex|v:1|p:openai'
$env:SHOPIFY_CLI_AGENT_IDS='s:cart-transform-poc|r:rust-spike-20260722|i:root'
shopify app config use dev
shopify app config validate --config dev --json
```

Expected: config is valid and identifies only `cart-transform-poc-dev`. Stop if the Client ID or app name differs.

- [ ] **Step 2: Generate with Shopify CLI**

Run:

```powershell
shopify app generate extension --config dev --template cart_transform --flavor rust --name master-kit-expand-rust-spike
```

Expected: Shopify CLI creates `extensions/master-kit-expand-rust-spike`; no app version is deployed.

- [ ] **Step 3: Assert isolation before editing**

Run:

```powershell
rg -n "master-kit-expand-rust-spike" scripts/function-profile.mjs shopify.app.toml shopify.app.dev.toml
```

Expected: no production profile or production config references the spike. A generated extension UID inside its own TOML is acceptable.

- [ ] **Step 4: Replace the generated input query with the approved contract**

Set `extensions/master-kit-expand-rust-spike/src/run.graphql` to:

```graphql
query Input {
  cart {
    lines {
      id
      quantity
      cost { amountPerQuantity { amount } }
      bundleId: attribute(key: "_bundle_id") { value }
      bundleSchemaVersion: attribute(key: "_bundle_schema_version") { value }
      parentProductGid: attribute(key: "_parent_product_gid") { value }
      parentVariantGid: attribute(key: "_parent_variant_gid") { value }
      parentSku: attribute(key: "_parent_sku") { value }
      parentTitle: attribute(key: "_parent_title") { value }
      builderEfiVariantId: attribute(key: "_builder_efi_variant_id") { value }
      builderFuelVariantId: attribute(key: "_builder_fuel_variant_id") { value }
      builderIgnitionVariantId: attribute(key: "_builder_ignition_variant_id") { value }
      builderDisplayVariantId: attribute(key: "_builder_display_variant_id") { value }
      merchandise {
        __typename
        ... on ProductVariant {
          id
          product {
            id
            prebuiltExpandProjectionMetafield: metafield(
              namespace: "aces_dev"
              key: "prebuilt_bundle_expand_projection_v1"
            ) { jsonValue }
          }
        }
      }
    }
  }
}
```

Run:

```powershell
git diff --no-index -- extensions/master-kit-expand/src/queries/run.dev.prebuilt-projection.graphql extensions/master-kit-expand-rust-spike/src/run.graphql
```

Expected: the only semantic difference is `query Input` versus `query RunInput`.

- [ ] **Step 5: Build the untouched generated extension**

Run:

```powershell
shopify app function build --path extensions/master-kit-expand-rust-spike
```

Expected: build succeeds before handwritten behavior is added.

- [ ] **Step 6: Record the intended commit boundary without committing**

Intended commit scope:

```powershell
git add extensions/master-kit-expand-rust-spike
git commit -m "chore(function): scaffold isolated Rust projection spike"
```

Do not execute these two commands until Huang separately approves commit creation.

### Task 3: Extract stable benchmark fixtures

**Files:**
- Create: `scripts/prebuilt-projection-benchmark-fixtures.mjs`
- Modify: `scripts/check-prebuilt-projection-function-budget.mjs`
- Create: `extensions/master-kit-expand-rust-spike/tests/fixtures/valid-8.json`
- Create: `extensions/master-kit-expand-rust-spike/tests/fixtures/valid-real-10.json`
- Create: `extensions/master-kit-expand-rust-spike/tests/fixtures/valid-12.json`
- Create: `extensions/master-kit-expand-rust-spike/tests/fixtures/invalid-parent.json`

**Interfaces:**
- Consumes: `calculatePrebuiltBundleExpandProjectionChecksum(projection)`.
- Produces: `buildProjectionBenchmarkCases(labels = ["8", "real-10", "12"])` returning `{label, componentCount, input}` objects and `writeRustSpikeFixtures(outputDirectory)` returning written paths.

- [ ] **Step 1: Write a failing fixture-contract test**

Add a Vitest test asserting:

```javascript
const cases = buildProjectionBenchmarkCases();
expect(cases.map(({ label, componentCount }) => [label, componentCount])).toEqual([
  ["synthetic-8", 8],
  ["real-10", 10],
  ["synthetic-12", 12],
]);
expect(cases[1].input.cart.lines[0].merchandise.id)
  .toBe("gid://shopify/ProductVariant/51592541503766");
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run scripts/prebuilt-projection-benchmark-fixtures.test.js
```

Expected: FAIL because `buildProjectionBenchmarkCases` is not defined.

- [ ] **Step 3: Move the existing fixture builders without changing data**

Move `buildRealTenInput`, `buildInput`, `buildProjectionInput`, and
`parseComponentCount` unchanged from the current budget script, then export
these exact public functions from the new module:

```javascript
export function buildProjectionBenchmarkCases(labels = ["8", "real-10", "12"]) {
  return labels.map((value) => value === "real-10"
    ? { label: "real-10", componentCount: 10, input: buildRealTenInput() }
    : {
        label: `synthetic-${value}`,
        componentCount: parseComponentCount(value),
        input: buildInput(parseComponentCount(value)),
      });
}

export function writeRustSpikeFixtures(outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const written = [];
  for (const benchmark of buildProjectionBenchmarkCases()) {
    const filename = benchmark.label === "real-10"
      ? "valid-real-10.json"
      : `valid-${benchmark.componentCount}.json`;
    const path = resolve(outputDirectory, filename);
    writeFileSync(path, `${JSON.stringify(benchmark.input, null, 2)}\n`);
    written.push(path);
  }
  return written;
}
```

Import `mkdirSync` and `writeFileSync` from `node:fs`, `resolve` from
`node:path`, and `buildProjectionBenchmarkCases` in the existing JavaScript
budget script. Delete its duplicate private builder definitions.

- [ ] **Step 4: Run the fixture test and existing JS budget check**

Run:

```powershell
npx vitest run scripts/prebuilt-projection-benchmark-fixtures.test.js
npm run check:function:prebuilt-projection-budget
```

Expected: fixture test passes; budget check reproduces approximately 9.32M for 8, 11.94M for real 10, and 12.69M for 12, and exits non-zero because the existing JS boundary still fails.

- [ ] **Step 5: Write the four JSON fixtures**

Generate the three valid fixtures from the shared builder. Create `invalid-parent.json` from `valid-8.json` with `merchandise.id` changed to `gid://shopify/ProductVariant/99999999999999` while leaving the projection parent unchanged.

- [ ] **Step 6: Record the intended commit boundary without committing**

Intended commit: `test(function): centralize projection benchmark fixtures`.

### Task 4: Implement Rust projection expansion test-first

**Files:**
- Modify: `extensions/master-kit-expand-rust-spike/src/main.rs`
- Modify: `extensions/master-kit-expand-rust-spike/src/run.rs`
- Test: `extensions/master-kit-expand-rust-spike/src/run.rs`

**Interfaces:**
- Consumes: generated `schema::run::Input` and `Projection` from the metafield `jsonValue` custom scalar override.
- Produces: `pub fn run(input: schema::run::Input) -> Result<schema::FunctionRunResult>` with zero or more expand operations.

- [ ] **Step 1: Bind the projection JSON scalar in `main.rs`**

Keep the CLI-generated entry point and configure type generation with this
module boundary:

```rust
use std::process;
use shopify_function::prelude::*;

pub mod run;

#[typegen("./schema.graphql")]
pub mod schema {
    #[query(
        "src/run.graphql",
        custom_scalar_overrides = {
            "Input.cart.lines.merchandise.on_ProductVariant.product.prebuiltExpandProjectionMetafield.jsonValue" => super::run::Projection
        }
    )]
    pub mod run {}
}

fn main() {
    eprintln!("Please invoke a named export.");
    process::exit(1);
}
```

- [ ] **Step 2: Define projection deserialization types**

Use only `shopify_function` derives; do not import `serde` or `serde_json` directly. Define fields matching the existing snake_case JSON:

```rust
#[derive(Deserialize, Default, PartialEq)]
pub struct Projection {
    pub schema_version: String,
    pub parent: ProjectionParent,
    pub components: Vec<ProjectionComponent>,
}
```

`ProjectionParent` contains `product_gid`, `variant_gid`, `sku`, and `title`. `ProjectionComponent` contains `sequence`, `group`, `role`, `product_gid`, `variant_gid`, `sku`, `title`, and `fixed_price_per_unit`.

- [ ] **Step 3: Write the valid-8 test before implementation**

Use only:

```rust
use super::*;
use shopify_function::{run_function_with_input, Result};
```

Run `valid-8.json`, assert one expand operation, eight expanded items, quantity one, fixed prices, order, and all ten Bundle Metadata V1/component attributes.

- [ ] **Step 4: Run the Rust test and verify RED**

Run:

```powershell
cargo test --manifest-path extensions/master-kit-expand-rust-spike/Cargo.toml valid_eight_components_expand
```

Expected: FAIL because the generated example does not implement projection expansion.

- [ ] **Step 5: Implement the minimum valid expansion path**

Implement these focused helpers in `run.rs`:

```rust
fn valid_metadata(line: &schema::run::input::cart::Lines) -> Option<BundleMetadata>
fn valid_projection<'a>(line: &schema::run::input::cart::Lines, projection: &'a Projection) -> Option<&'a Projection>
fn decimal_cents(value: &str) -> Option<i64>
fn build_expand(line: &schema::run::input::cart::Lines, metadata: &BundleMetadata, projection: &Projection) -> schema::ExpandOperation
```

The price comparison uses integer cents; every component quantity is one; emitted attributes use the exact keys from the accepted JavaScript candidate.

- [ ] **Step 6: Run valid-8 and verify GREEN**

Run the focused Cargo test and `shopify app function build --path extensions/master-kit-expand-rust-spike`.

Expected: both pass.

- [ ] **Step 7: Add fail-closed tests one behavior at a time**

Add and watch each test fail before implementation for: missing projection, wrong schema version, parent product mismatch, parent variant mismatch, missing Bundle Metadata V1, invalid decimal, component-price total mismatch, empty components, duplicate sequence, duplicate component variant, and duplicate `_bundle_id` across qualifying lines.

- [ ] **Step 8: Implement only the validation needed by the failing tests**

Return `schema::FunctionRunResult { operations: vec![] }` for every invalid case. Use a `HashSet` only when more than one qualifying line or component requires duplicate detection.

- [ ] **Step 9: Run the complete Rust suite**

Run:

```powershell
cargo test --manifest-path extensions/master-kit-expand-rust-spike/Cargo.toml
shopify app function build --path extensions/master-kit-expand-rust-spike
```

Expected: all Rust tests pass and `dist/index.wasm` is produced.

- [ ] **Step 10: Record the intended commit boundary without committing**

Intended commit: `feat(function): add Rust prebuilt projection expander`.

### Task 5: Add exact output parity and instruction gates

**Files:**
- Create: `scripts/prebuilt-projection-rust-spike-result.js`
- Create: `scripts/prebuilt-projection-rust-spike-result.test.js`
- Create: `scripts/check-prebuilt-projection-rust-spike.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: JS and Rust runner outputs `{ output, instructions }`.
- Produces: `compareFunctionOutputs(expected, actual)` and `classifyInstructionBudget(instructions, limit = 11_000_000, target = 8_800_000)`.

- [ ] **Step 1: Write failing gate tests**

Assert exact deep equality, field-order-insensitive object comparison, array-order-sensitive component comparison, hard failure above 11,000,000, risk-review status from 8,800,001 through 11,000,000, and pass status at or below 8,800,000.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run scripts/prebuilt-projection-rust-spike-result.test.js
```

Expected: FAIL because the result helpers do not exist.

- [ ] **Step 3: Implement the pure result helpers**

Return classifications with this exact shape:

```javascript
{ status: "pass" | "risk-review" | "fail", instructions, headroom: 11_000_000 - instructions }
```

Throw a descriptive parity error identifying the fixture label and first differing JSON path.

- [ ] **Step 4: Implement the orchestration script**

For each shared fixture, the script must:

1. Build/run the JavaScript `prebuilt-projection-candidate` profile.
2. Build/run `extensions/master-kit-expand-rust-spike`.
3. Compare output exactly.
4. Record both instruction counts and the Rust classification.
5. Exit non-zero for parity mismatch or hard-limit failure.
6. In `finally`, rebuild the production JavaScript profile and run `scripts/assert-production-function-clean.mjs`.

- [ ] **Step 5: Add the package command**

Add:

```json
"check:function:prebuilt-projection-rust-spike": "node scripts/check-prebuilt-projection-rust-spike.mjs"
```

- [ ] **Step 6: Run parity and budget acceptance**

Run:

```powershell
npm run check:function:prebuilt-projection-rust-spike
```

Expected: exact output parity for 8, real 10, and 12. Each Rust fixture must be below 11,000,000; at or below 8,800,000 is the preferred acceptance result.

- [ ] **Step 7: Record the intended commit boundary without committing**

Intended commit: `test(function): gate Rust projection parity and budget`.

### Task 6: Verify isolation and record the decision

**Files:**
- Modify: `docs/DEV_CATALOG_TECHNICAL_BATCH_3_2026-07-22.md`
- Modify only if business status changes: `docs/PROJECT_BUSINESS_PROGRESS_2026-07-21.md`

**Interfaces:**
- Consumes: exact parity report, instruction report, full local verification.
- Produces: evidence-backed recommendation: integrate, optimize once, or stop the Rust path.

- [ ] **Step 1: Run focused and full verification**

Run:

```powershell
cargo test --manifest-path extensions/master-kit-expand-rust-spike/Cargo.toml
npm run check:function:prebuilt-projection-rust-spike
npm test
npm run test:function
npm run lint
npm run build
npm run validate:local
npm run assert:function:production-clean
git diff --check
```

Expected: all commands pass except that a Rust `risk-review` classification is allowed only when still below the hard limit; it must be reported, not silently treated as the 20% target passing.

- [ ] **Step 2: Verify no live mutation occurred**

Run:

```powershell
git diff -- shopify.app.toml shopify.app.dev.toml scripts/function-profile.mjs
```

Expected: no production config or current JavaScript profile authority change. Do not run deploy, store mutation, or registration commands.

- [ ] **Step 3: Update technical evidence**

Record exact Rust instruction counts, JS instruction counts, parity status, toolchain versions, test commands, and one of these decisions:

- `integrate`: all fixtures have parity and at least 20% headroom;
- `optimize-once`: parity passes and all fixtures are under the hard limit but one misses 20% headroom;
- `stop`: any fixture exceeds the hard limit or parity fails after bounded correction.

- [ ] **Step 4: Self-review the task diff**

Confirm no secrets, generated production artifacts, unrelated dirty files, store data, or deployment state are included.

- [ ] **Step 5: Prepare but do not create the final commit**

Intended commit: `docs(function): record Rust projection spike evidence`.

Request explicit approval before staging, committing, pushing, deploying, or starting a hosted Checkout acceptance window.
