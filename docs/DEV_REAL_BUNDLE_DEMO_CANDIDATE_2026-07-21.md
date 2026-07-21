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

The published AF4005P Projection and the deployed development Function were
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
Extension asset change and verify a newly added AF4005P line through `/cart.js`:
`properties` must include `_bundle_id`, `_bundle_schema_version`,
`_parent_product_gid`, `_parent_variant_gid`, `_parent_sku`, and
`_parent_title`. Only then repeat Checkout, Order, and component-inventory
verification.
