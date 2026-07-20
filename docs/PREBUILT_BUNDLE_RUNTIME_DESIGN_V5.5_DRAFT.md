# Pre-built Bundle SKU Runtime Design V5.5 Draft

Status: local design draft. This is not an authority change, Function implementation, deployment plan, or Shopify write authorization.

## 2026-07-20 Hosted Candidate Status

Development version `cart-transform-poc-dev-40` is the frozen known-good baseline for the
approved test SKU. It proves the expected Cart and Checkout shape with a bounded fixed
projection. The generic profile that resolved the full mapping/Snapshot during Checkout
remained a hosted no-op in version 39 and is not accepted.

The next design revision should compile fixed selections into a compact, checksum-bound
ready-to-expand projection at publication time. The hosted Function should validate that
projection and emit expand operations without executing the complete Bundle resolver and
diagnostic graph during Checkout. This does not change production authority. See
[`PREBUILT_CHECKOUT_EXPANSION_HANDOFF_2026-07-20.md`](./PREBUILT_CHECKOUT_EXPANSION_HANDOFF_2026-07-20.md).

## Objective

Add the second approved purchase input without changing Option C semantics:

1. Builder purchase: trusted cart selection attributes choose the component set.
2. Pre-built SKU purchase: the parent Variant's published fixed Bundle revision chooses the component set.

Both paths retain one Master Kit parent line in Cart and expand only during Checkout/Order processing. Component inventory remains the only inventory authority.

## Runtime Input Boundary

The future Function query must distinguish input origin from client-provided content:

- Parent product/Variant GID is the only customer-originating identifier used to look up a pre-built Bundle mapping.
- Builder selections remain inputs only for Builder-associated parent lines.
- A client must never submit a component list, Snapshot, parent-to-component mapping, price, revision ID, publication ID, or runtime mode.
- The published server-owned mapping must bind parent Variant -> BundleDefinition -> active published Revision -> checksum-verified Runtime Snapshot.

No mapping is inferred from SKU text, product title, URL, cart properties, or a client metafield value.

## Resolution Algorithm

1. Read the cart line's merchandise Variant GID.
2. If it is the legacy hard-coded Builder parent Variant, retain the current Shared Core path unchanged.
3. Otherwise read a server-owned published pre-built mapping for exactly that Variant.
4. Reject/fall back when the mapping is absent, stale, non-published, outside the approved pilot scope, checksum-invalid, oversize, unsupported, or non-parity.
5. Resolve the fixed selections from the published revision only. Do not read Builder selection attributes for a pre-built line.
6. Construct a fresh expand result and compare it with the accepted required operation schema before return.
7. A failed gate must return the hard-coded Shared Core result for the legacy parent and must not invent an expansion for an unknown SKU.

The exact behavior for a non-legacy, unmapped parent Variant must be explicitly selected before implementation. The current recommended behavior is no operation for that line, because expanding unrelated Shopify products would violate Option C.

## Local Fixed-Selection Resolver Contract

The local-only `prebuilt-bundle-runtime.selection.js` module now proves the fixed-selection half of this design without changing a Function entry. It accepts only a parent Variant GID, a server-owned `prebuilt_bundle_runtime_mapping.v1` record, and a checksum-valid Runtime Snapshot. The mapping must be `published`, explicitly pilot-approved, bind the exact parent Variant and BundleDefinition, and provide one known fixed option for every Snapshot group.

The resolver deliberately accepts no cart attributes, SKU/title matching input, cart properties, URL values, or client selection document. It returns either a newly constructed resolved component result or an immutable unresolved reason such as `UNMAPPED_PARENT_VARIANT`, `INVALID_MAPPING`, or `SNAPSHOT_CHECKSUM_MISMATCH`. It does not construct a Function operation or change production behavior.

`prebuilt-bundle-runtime.preparation.js` composes this resolver across cart lines through injected server-side mapping and Snapshot lookups. It keeps each matching cart-line candidate separate, discards unknown or failing lines, and still produces no Function operations. This is the local boundary before a separately approved result-construction and bundle-instance metadata decision.

`prebuilt-bundle-runtime.result.js` converts prepared candidates into fresh supported
`expand` operations with ordered components, quantity `1`, and the existing Snapshot
price allocation. In the dev-only Function candidate composition, it now receives only
Bundle Metadata V1 that has passed cart-line correlation checks. It propagates the
validated bundle instance ID and schema version, while parent and component identity,
SKU, title, role, sequence, and Variant attributes are derived from the checksum-valid
server Snapshot. Client values never become component or price authority.

`prebuilt-bundle-metadata.contract.js` now defines the only permitted normal-product
add-to-cart metadata shape: a browser-generated UUID plus parent identity and display
fields. It deliberately excludes selections, component IDs, prices, mapping IDs, and
Snapshot data, so client metadata remains correlation-only. The module is not imported
by a production Function entry. The local Theme App Extension now has a separate
`prebuilt-bundle-product-form` block that injects the same checked field shape into a
native product form at submit time. It is disabled by default, must be placed only in
an approved pre-built product template, generates a new UUID per add, and explicitly
ignores the isolated Builder form. It does not add selections, component IDs, prices,
mapping IDs, or Snapshot data. It is not deployed as a production app extension. A
development-theme preview has verified the normal-product add-to-cart path: a
quantity-one parent line receives a fresh Metadata V1 correlation record in `/cart.js`,
while a requested native quantity other than one is blocked before it can reuse one
`_bundle_id` across multiple instances. The subsequent development Checkout test failed
to expand that parent line, as recorded in the 2026-07-20 hosted candidate status. This
remains neither a successful Function/Checkout result nor Order, inventory, or
production deployment verification.

Local two-path tests now prove that the hard-coded Builder Standard selection and a published fixed pre-built Standard mapping produce the same component/price projection. They also prove that the Advanced selection, including its optional Display component, has the same four-component price projection through both paths. Multiple pre-built cart lines remain independent and unrelated SKUs receive no pre-built operation. This remains local simulation evidence, not Shopify-hosted Function evidence.

`prebuilt-bundle-cart-metadata.observation.js` is the local query-shape boundary
between the normal-product Theme block and the future candidate. It accepts only a
Bundle Metadata V1 UUID, schema version `1`, quantity `1`, and parent product/Variant
metadata that exactly matches the actual Cart line merchandise. Missing, malformed, or
mismatched values produce no local pre-built candidate. This correlation check does not
make client values authoritative: published mappings and checksum-verified Snapshots
remain the only component and price inputs. The module is not imported by a Function
entry and does not remove the separate integration approval gate.

The local candidate composition also rejects every otherwise-valid Cart line sharing a
duplicate `_bundle_id`. This makes the per-instance correlation fail closed before any
future pre-built operation is constructed; it never chooses one duplicate line to
expand and never treats client metadata as component authority.

## Published Mapping Derivation

The local `derivePrebuiltBundleRuntimeMapping()` helper derives a mapping and a
checksum-bound `prebuilt_bundle_expand_projection.v1` only when all
of the following server-owned records agree: a valid `BundleDefinition`, its matching
active `published` `BundleRevision`, and the immutable Revision `runtime_snapshot_ref`.
The Snapshot must match the Definition ID, parent Variant, version, and checksum.

The helper also requires an explicit local pilot allowlist containing the parent Variant.
Pilot approval is intentionally not inferred from cart input, a product property, or the
presence of a Definition. An out-of-scope, draft, stale, or malformed record returns no
mapping. This remains a local derivation contract; it neither reads nor writes Shopify
resources and is not imported by either Function entry.

The allowlist uses the existing `prebuilt_bundle_pilot_scope.v1` contract rather than a
runtime-specific shortcut. `createPrebuiltBundleRuntimeAssignments()` converts only
`ready_for_confirmation` reviewed import-plan records into immutable assignments. An
assignment binds source identity/fingerprint, BundleDefinition, parent Variant, fixed
selections, and the Pilot Scope ID. Rejected, duplicate, or out-of-scope records cannot
enter the runtime catalog.

`assessPrebuiltBundleRuntimeReadiness()` provides a local audit of the complete chain:
reviewed import plan, assignment, active published Revision, checksum-verified Snapshot,
and runtime catalog. A `ready` mapping result is evidence only. It is not a publish
approval and cannot change Function authority. Every audit result separately reports
the local normal-product Bundle Metadata V1 contract as `local_contract_only` and keeps
Function integration `blocked` until the Theme block has been verified on a development
store Cart line and the candidate query/gate review is approved. The Theme Cart-line
verification is now complete, but candidate query/gate review remains separately
blocked. This prevents a valid parent-Variant mapping from being mistaken for
permission to invent `_bundle_id` or emit incomplete order metadata.

`buildPrebuiltBundleRuntimeCatalog()` gathers only those ready mappings into a
read-only local catalog. The catalog is an explicit hand-off boundary for a future
server-owned lookup provider: unapproved, invalid, or inactive records are reported as
unavailable and cannot be found by Variant GID. The current Cart Transform does not
import this catalog.

## Publication and Migration Relationship

An imported record is eligible only after its source fingerprint, parent binding, fixed component parity, target Bundle Config, and Pilot Scope were reviewed. The future execution order is:

1. Dry-run import plan.
2. Explicit operator confirmation.
3. Idempotent target Definition/Draft Revision creation with durable source ledger.
4. Standard validation, preview, promotion evidence, publish, read-back, audit, and rollback controls.
5. Runtime mapping activation only after the published revision and Snapshot are verified.

No import may directly write a Runtime Snapshot or active pointer outside the existing publication service.

## Local Candidate Composition

`buildPrebuiltBundleRuntimeLocalCandidate()` composes the local catalog, Snapshot map,
cart-line preparation, and fresh `expand` result construction. It proves that only an
approved parent Variant produces a pre-built candidate while unrelated product lines and
client attributes are ignored. Before returning, it runs the existing lightweight
supported-operation-shape inspection and reports any unsupported fields. It is not
imported by a Function entry and performs no Shopify reads or writes.

`prebuilt-bundle-runtime.function-input.js` and
`prebuilt-bundle-runtime.function-candidate.js` provide the next local-only hand-off:
a future query may return product-owned mapping and Snapshot metafields as `jsonValue`
or JSON `value`; the modules parse them, bind both records to the actual Variant GID,
verify Definition ID and checksum agreement, then pass only that normalized input through
the same Metadata V1 and fixed-selection gates. Conflicting server metafield data fails
closed. Neither module is imported by a production Function entry or query profile.
They are used only by development-only profiles. The parsing-only `prebuilt-observe`
profile was deployed to the development app for controlled observation validation; no
production profile was deployed.

## Controlled Pilot Gates

The local-only Function profile sequence is deliberately staged: `prebuilt-observe`
parses server-owned inputs and discards them; `prebuilt-resolve-observe` also runs the
candidate preparation and discards it; and `prebuilt-candidate` can return a fresh merged
result only after all Metadata V1, Mapping/Snapshot binding, preparation-count,
supported-operation-shape, and Cart-line-conflict gates pass. Every failure returns a
fresh clone of the hard-coded Shared Core result. These profiles are restricted to the
development app config, restore the production query/types/artifact after a local build,
and are limited to the development app. The later hosted `prebuilt-candidate` test is
documented above as blocked; it is not positive Checkout-expansion evidence.

The first live scope must be one approved store plus one approved product series. Before expansion beyond the pilot, evidence must cover:

- direct normal-product add-to-cart of a pre-built SKU;
- one parent line per bundle instance in Cart;
- Checkout, Order, fulfillment, and component-only inventory outcomes;
- repeated instances and quantity behavior;
- monitoring, fail-closed fallback, and documented rollback;
- unchanged Builder and legacy hard-coded Master Kit regressions.

## Explicit Non-Goals

- No `lineUpdate`.
- No runtime `productVariantComponents`.
- No editable Runtime Snapshot.
- No Custom Distribution App changes.
- No production authority change until a separate V5.5 approval, local Function tests, development-store evidence, and full Browser -> Cart -> Checkout -> Order -> Inventory regression are accepted.
