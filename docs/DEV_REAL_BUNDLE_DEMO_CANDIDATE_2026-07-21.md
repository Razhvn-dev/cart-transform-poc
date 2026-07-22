# Development Real Bundle Demo Candidate — 2026-07-21

## Purpose

This is the first clean, real-catalogue development demo candidate for Bundle Admin.
It is intentionally limited to a quantity-one source relationship and does not
publish a Runtime Snapshot, activate a Cart Transform, alter inventory, or touch
production.

## Verified development-store identities

Target: `cart-transform-poc-dev` on `huang-mvqquz1p.myshopify.com`.

| Role | SKU | Shopify product | Shopify variant |
| --- | --- | --- | --- |
| Parent | `AF4005PK` | `gid://shopify/Product/10638462877974` | `gid://shopify/ProductVariant/51592671789334` |
| Component | `AF4005P` ×1 | `gid://shopify/Product/10638462877974` | `gid://shopify/ProductVariant/51592671756566` |
| Component | `AF2009P` ×1 | `gid://shopify/Product/10638465335574` | `gid://shopify/ProductVariant/51592717566230` |

All three identities were read from the development store on 2026-07-21 and are
`ACTIVE`. The source relationship is record `AF4005PK` in the Bundles.app full
catalogue preflight and has no quantity or identity finding.

## Creation boundary

After the development app containing the new Create development Bundle form is
released, create a new Definition with:

```text
slug: real-af4005pk-pressure-sensor-demo
parent product GID: gid://shopify/Product/10638462877974
parent variant GID: gid://shopify/ProductVariant/51592671789334
```

Creation persists only the Definition. The required next step is a draft revision
whose fixed component selection resolves to `AF4005P ×1` and `AF2009P ×1`; this
must be validated and reviewed before any separately approved publish or Checkout
test.

## Verified draft and Function evidence

The development-only Definition was created and persisted as
`real-af4005pk-pressure-sensor-demo` (`4b5c384b-acc6-455d-b14a-7a1e6d433ffc`).
Its first draft Revision is `e94be6f4-e08d-483b-9dcc-d80b98ee4246`.

- Validation passed with no errors or warnings.
- Compile preview produced configuration version `1`, two components, two groups,
  and Snapshot checksum `637f5b3f` (1,808 bytes).
- Publish readiness passed locally with no blockers. It correctly requires runtime
  promotion parity and an explicit authorization before any Snapshot write.
- The earlier `cart-transform-poc-dev-41` candidate-profile observation is retained
  only as historical diagnostic evidence. It is not the current deployment fact;
  the current Cart Transform binding is recorded in the read-only live check below.
- The candidate profile preserves the hard-coded Master Kit expansion as a fallback;
  a pre-built line expands only when its mapping and Runtime Snapshot are complete
  and internally consistent.

This does not publish the real AF4005PK draft or change its inventory. The remaining
runtime evidence is the real Checkout observation, followed by Order and inventory
acceptance before a real-catalogue migration can be claimed.

## Related regression acceptance

The isolated `prebuilt-bundle-test` regression sample has now passed Cart, Checkout,
Order Admin, and component-inventory acceptance in the development store. Its
evidence is recorded in `docs/DEV_PREBUILT_REGRESSION_ACCEPTANCE_2026-07-21.md`.
It verifies the locked Option C behavior, but it does not activate this AF4005PK
candidate or substitute for real-catalogue migration evidence.

## Read-only live binding check

On 2026-07-21, the development-only binding diagnostic confirmed exactly one Cart
Transform registration in `huang-mvqquz1p.myshopify.com`:

- Cart Transform: `gid://shopify/CartTransform/136675606`
- Function: `019f5e8c-0374-7577-b756-66af47a751be` (`Master Kit Expand`)

The registration resolves correctly. It proves the live invocation binding is not
the blocker for the real-catalogue pilot. The remaining blocker is the deliberately
separate publication/promotion path for the AF4005PK draft and its server-owned
Runtime Snapshot and mapping.

## Development transition profile

The local `prebuilt-candidate-static-fallback` profile is now ready for a controlled
development-only deployment. It evaluates a complete, server-owned pre-built mapping
first and retains the proven `prebuilt-bundle-test` static regression expansion for
any cart line that the candidate did not handle. It excludes every line already
handled by the candidate or Shared Core before invoking the static probe, preventing
duplicate expand operations.

Its local build restores the production query, generated types, JavaScript artifact,
and Wasm artifact before returning. This closes the former safety gap in which a
development Function build could leave a development `dist/function.js` artifact
behind locally.

The explicit development-only deployment command is:

```text
npm run deploy:function:prebuilt-candidate-static-fallback
```

Run it only when the next controlled development-store Function change is intended.
It does not publish the AF4005PK draft, write its Runtime Snapshot, or authorize any
production operation.

## 2026-07-21 real-candidate runtime preflight

The development-only Function has since been released as
`cart-transform-poc-dev-49` with the
`prebuilt-projection-static-fallback` profile. This profile reads the existing
development Projection carrier (`aces_dev.prebuilt_bundle_expand_projection_v1`)
first and retains the proven static regression sample only for lines that were
not handled by the Projection path. Production and the Custom Distribution app
remain untouched.

Read-only Shopify evidence collected before the subsequent controlled publication
attempt confirmed:

- Definition `4b5c384b-acc6-455d-b14a-7a1e6d433ffc` remains unactivated;
  Revision `e94be6f4-e08d-483b-9dcc-d80b98ee4246` remains `draft`.
- The parent had no active-revision pointer or Projection. A matching candidate
  Runtime Snapshot (`637f5b3f`) was subsequently observed with the pointer still
  unset, so the candidate must be treated as a resumable partial development
  state rather than recreated.
- The draft compiles to Snapshot `637f5b3f` (1,808 bytes).
- A local, publish-state simulation compiles a valid Projection `822f1465` with
  `AF4005P` at `$469.99` and `AF2009P` at `$119.99`.

This is a verified boundary, not a live publication. The current guarded
publication service correctly refuses to promote AF4005PK because its sole
promotion-evidence generator requires exact parity with the hard-coded Master
Kit Shared Core. A real pre-built SKU is deliberately not a second Master Kit,
so that parity check cannot legitimately pass. Do not bypass or weaken this
gate. The remaining development work is a separately reviewed, Projection-path
publication evidence and persistence flow: it must validate the exact fixed
components, prices, parent binding, Snapshot/Projection checksums, active
pointer, read-back, audit record, and recovery behavior before it writes this
candidate's live carrier.

The local `prebuilt_projection_publication_evidence.v1` helper now supplies the
first part of that flow. It binds the exact draft, parent binding, default fixed
selections, Snapshot checksum, Projection checksum, component sequence, Variant
GIDs, and fixed prices; it rejects any altered component price. It is local
evidence only and does not enable publication by itself.

## 2026-07-21 controlled-publication transport incident

The exact publication-record handle was read as absent before a controlled
development-only attempt. The attempt then exceeded its command timeout while
the Shopify CLI Admin API channel was unstable. A follow-up read also failed with
`Client network socket disconnected before secure TLS connection was established`.
The public HTTPS endpoint remained reachable, which localizes the fault to the
CLI authenticated transport rather than the development store or Function.

No automatic retry or compensating mutation is permitted while the result is
unknown. The next operation must be a successful read-only reconciliation of the
Definition, Revision, active pointer, Snapshot, Projection, and exact publication
record. Only then may the resumable development-only publication continue.

## 2026-07-21 recovery completion

After local Shopify CLI authentication was refreshed, a single-request recovery
preflight established the exact partial state. The recovery then completed with
three serial, response-verified development-store mutations only:

1. wrote Projection `822f1465` to
   `aces_dev.prebuilt_bundle_expand_projection_v1`;
2. aligned the BundleDefinition active pointer with the already-published
   Revision; and
3. created the exact PublicationRecord audit entry.

The final read-back confirms all of the following target
`e94be6f4-e08d-483b-9dcc-d80b98ee4246`:

- Revision status is `published`.
- BundleDefinition and product active pointers both reference that Revision.
- Runtime Snapshot checksum is `637f5b3f`.
- Projection checksum is `822f1465`.
- PublicationRecord exists.

The development-only real-SKU carrier is now complete. It still requires the
separate Browser -> Cart -> Checkout -> Order -> component-inventory acceptance
run before the AF4005PK pilot can be claimed as end-to-end verified.

## Legacy-record boundary

The Bundle Admin list currently contains historical development and rehearsal
Definitions. They are not this real demo candidate. Do not delete them through a
generic Metaobject mutation: their associated audit/rehearsal resources must first
be classified and removed through a development-only, read-back-verified cleanup
operation.

## 2026-07-21 storefront metadata injection incident

The published AF4005PK Projection and the deployed development Function were
verified separately. The failing cart was then inspected through `/cart.js`:
the parent line had an empty `properties` object. This is the direct reason the
Function did not expand it: Bundle Metadata V1 was absent, so the Function
correctly rejected the line rather than fabricating a bundle instance.

The defect is isolated to the Theme App Extension asset
`prebuilt-bundle-product-form.js`. Dawn can serialize its AJAX add-to-cart
request immediately after the native button click; the asset previously wrote
Metadata V1 only in its later `submit` handler. The local fix writes the same
strict Metadata V1 fields in the capture-phase native add-to-cart click handler
before Dawn constructs its request, while retaining the submit handler and the
one-item quantity guard. It does not alter component selection, pricing,
Projection data, Function authority, or the Builder path.

Before accepting the real storefront pilot, release this isolated Theme App
Extension asset change and verify a newly added AF4005PK line through `/cart.js`:
`properties` must include `_bundle_id`, `_bundle_schema_version`,
`_parent_product_gid`, `_parent_variant_gid`, `_parent_sku`, and
`_parent_title`. Only then repeat Checkout, Order, and component-inventory
verification.

## 2026-07-21 live Theme assembly diagnosis

A later read-only storefront inspection corrected the affected parent identity
and localized the remaining failure more precisely:

- The selected real parent Variant is `AF4005PK`
  (`gid://shopify/ProductVariant/51592671789334`). `AF4005P` is its component
  Variant on the same Shopify Product.
- The live product page contains two native `/cart/add` forms, but neither form
  contains Bundle Metadata V1 inputs.
- The page contains no `data-prebuilt-bundle-product-form` marker and does not
  load `prebuilt-bundle-product-form.js`.
- Development App version `cart-transform-poc-dev-54` is active. The remaining
  live gap is therefore Theme App Extension block placement/configuration on the
  real product template, not the Cart Transform binding or Projection carrier.

The local Theme block now requires an exact, unique parent SKU binding before it
renders any marker or asset. This prevents the component `AF4005P` from being
mistaken for a bundle parent merely because it shares the Product with
`AF4005PK`. Direct request enrichment also refuses multi-quantity inputs. The
local change passed Theme Check, the complete app/Function validation chain, and
the full test suite, but it has not been deployed or configured in Shopify.

## 2026-07-21 Theme fix activation and read-back

The fix was released only to the development App as active version
`cart-transform-poc-dev-55`, retaining the
`prebuilt-projection-static-fallback` Function profile. The published theme's
Default product template now contains the `Prebuilt bundle metadata` App block
with `Bundle parent SKU` set to `AF4005PK`.

Live storefront read-back confirmed one marker containing only parent Variant
`51592671789334`, the v55 asset URL, and all six Metadata V1 inputs on both
native `/cart/add` forms. Selecting component Variant `AF4005P`
(`51592671756566`) produced zero form property inputs while the marker continued
to contain only `AF4005PK`, proving the component isolation boundary.

The next blocker is catalogue availability, not Theme assembly. Parent
`AF4005PK` currently has Available/On hand `0/0` at Shop location with
out-of-stock selling disabled. Components `AF4005P` and `AF2009P` both have
Available/On hand `9/9`. A separately approved, temporary development inventory
baseline is required before Cart, Checkout, Order, and inventory acceptance can
continue.

## 2026-07-21 Function deployment artifact root cause

The first real Cart and Checkout run proved that Metadata V1 was present but the
parent still did not expand. The same active version also failed to expand the
previously accepted `prebuilt-bundle-test`, and the bounded Function stream
received no static-probe marker. The cause was the local deployment pipeline,
not the Cart Transform registration:

- `build-function.mjs` correctly built the selected development entry, but then
  rebuilt `dist/index.wasm` from production `run.js` before returning;
- `deploy-function-profile.mjs` subsequently used `shopify app deploy --no-build`,
  so versions 55 and 56 packaged that restored production Wasm rather than the
  requested Projection/static profile;
- version 57, built after the deployment-window artifact fix, immediately
  restored the known static three-component test expansion and expanded
  AF4005PK into its two real components.

The deploy orchestrator now retains a dev artifact only while packaging the
explicit dev profile and dev config. The flag is rejected outside that
orchestrator, and the outer `finally` restores and validates production query,
generated types, JavaScript, and Wasm after both successful and failed deploys.

## 2026-07-21 AF4005PK price guard and real acceptance

The hosted static bisect also proved Shopify accepts the published component
prices, but their sum was wrong: `$469.99 + $119.99 = $589.98` versus the live
parent price `$559.99`. The development Projection path now queries the live
parent line amount and fails closed unless all component fixed prices sum to the
same amount. The exact AF4005PK dev fallback uses the existing reviewed
proportional allocation, `$446.10 + $113.89 = $559.99`.

Active development version `cart-transform-poc-dev-58` passed the complete real
storefront acceptance:

- Cart: one AF4005PK parent with all six Metadata V1 properties.
- Checkout: two expanded components, AF4005P and AF2009P, total `$559.99`.
- Test order `#1014`: only AF4005P at `$446.10` and AF2009P at `$113.89`;
  AF4005PK is absent from the order lines.
- Inventory: both components' Available quantity changed from 9 to 8. Their
  On hand quantity remains 9 while the order is unfulfilled; the order reserves
  one unit of each component. The parent stayed at 1 throughout the order and
  was then restored to Available/On hand `0/0` with read-back confirmation.

This acceptance is development-only and uses a narrow static safety fallback.
The persisted Projection `822f1465` still carries the undiscounted `$589.98`
total and is rejected by the new price gate. The next generic-runtime task is a
new immutable price-evidenced revision/Projection whose allocation totals the
live parent price; do not overwrite the published revision or weaken the guard.

## 2026-07-21 price-evidenced Projection promotion and no-fallback acceptance

The development-only immutable successor is now published and read back:

- Revision 1 `e94be6f4-e08d-483b-9dcc-d80b98ee4246` is `superseded`.
- Revision 2 `7b886b43-0e58-47cb-a78d-e05930d75391` is `published` and active.
- Price evidence checksum is `1d553d8a`; it records the live `$559.99` parent,
  `$589.98` component subtotal, proportional allocation, and exact component
  allocations `$446.10 + $113.89`.
- Runtime Snapshot checksum is `9dbc2455` and Projection checksum is `8ab90f06`.
- Both the domain publication record and Projection publication record exist.

Shopify CLI transport interrupted the first domain publication after the new
Snapshot and product active pointer were written. The resumable promotion
command detected the exact partial state, completed the immutable domain
lifecycle, wrote the recovery-bound audit, and then published the Projection.
No resource was deleted or recreated.

Active development version `cart-transform-poc-dev-59`, message
`projection-price-evidenced-no-static-fallback`, runs the pure
`prebuilt-projection-candidate` profile. Read-back confirms v59 is active and
the single Cart Transform registration still resolves to `Master Kit Expand`.

The real browser regression passed without the AF4005PK static fallback:

- Cart contained one AF4005PK parent at `$559.99`.
- Checkout displayed the parent summary with two expanded child items,
  AF4005P and AF2009P, and total `$559.99`.
- No order was submitted in this regression because order `#1014` already
  proves the component-only Order and inventory behavior for the same prices.
- The test cart was emptied and temporary parent inventory was restored from
  Available/On hand `1/1` to `0/0`, with read-back confirmation.

The AF4005PK exact-parent static branch is removed locally. The price mismatch
guard remains fail closed, while the unrelated isolated regression probe stays
development-only. Production runtime authority and the Custom Distribution App
remain unchanged.

## 2026-07-22 component-breadth hosted bisect

The second technical breadth batch persisted and read back exact Definitions,
Revisions, Snapshots, Projections, and Publications for the three-component
`AS2008C` and four-component `AS2020PS` parents. Under the pure v59 Projection
candidate, their Checkout sessions retained the parent even though storefront
Metadata V1 and local candidate results were exact.

Development version `cart-transform-poc-dev-60`, message
`component-breadth-static-hosted-bisect`, added only exact static probes for these
two parent Variants. A genuinely fresh incognito session then passed for `AS2008C`:

- Cart retained one `High Roller (Classic)` parent at `$139.99`.
- Checkout expanded exactly three component items and preserved the `$139.99` total.
- No order was submitted.
- All seven temporary inventory targets were restored from `1/1` to their original
  `0/0`, with read-back confirmation.

This proves that the active Cart Transform binding, hosted invocation, and Shopify
expand payload are functional. The remaining defect is confined to the hosted v59
Projection candidate path. v60 is a development-only diagnostic fallback and must
not be treated as the generic runtime fix or a production-authority change.

## 2026-07-22 Projection promotion root cause and generic acceptance

The hosted boundary was narrowed with two development-only versions. v61 executed
the full Projection candidate and surfaced `[projection:ready:1:1]` through the
proven static response, demonstrating that hosted Projection input, validation, and
candidate construction succeeded. v62 bypassed only the redundant second
clone/deep-freeze traversal in candidate promotion; the real three-component
Projection then expanded correctly in Checkout.

The minimal generic fix reuses candidate operations only when the candidate result
and operation list are already frozen by the builder. Shared Core operations remain
defensively cloned, non-frozen candidates retain the previous clone behavior, and
the combined result remains deeply frozen. This removes the redundant hosted
traversal without weakening the immutability boundary.

Active development version `cart-transform-poc-dev-63`, message
`projection-promotion-runtime-cost-fix`, now runs the repaired generic
`prebuilt-projection-candidate` profile. Real storefront acceptance passed for both
technical breadth parents:

- `AS2008C`: one Cart parent, three Checkout components, `$139.99` total.
- `AS2020PS`: one Cart parent, four Checkout components, `$559.99` total.

No order or payment was created. The cart was emptied and inventory window
`v63-projection-fix-1` restored all seven temporary targets to their exact original
`0/0` state. The production query, generated types, and Wasm were restored and
passed the production-clean assertion. Production runtime authority remains the
hard-coded Shared Core.
