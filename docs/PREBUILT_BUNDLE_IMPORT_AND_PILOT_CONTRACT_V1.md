# Pre-built Bundle Import and Pilot Contract V1

Status: local contract plus controlled development-store rehearsal evidence. This document supplements the V5.4 locked baseline; it does not change Runtime Snapshot authority or authorize production Shopify operations.

## Purpose

The contract prepares the second purchase path: a customer adds a normal Shopify pre-built Bundle SKU, while the future runtime resolves its published fixed component set. It also prepares a reviewable import from the current paid application.

## Local dry-run inputs

- `PrebuiltBundleImportSourceRecord`: source-system ID, source checksum, approved product-series key, parent product/Variant binding, and ordered component Variant IDs. Component quantity is currently constrained to `1` because Bundle Config V1 resolves one active option per component group.
- `PrebuiltBundleImportMapping`: source identity, target `bundle_definition_id`, matching parent binding, complete Bundle Config V1 document, and fixed selections keyed by stable `group_key`.
- `PilotScope`: one store domain, approved product-series keys, and approved parent Variant GIDs.

`bundle_definition_id` remains the durable target identity. `_bundle_id` is not accepted by this contract and remains reserved for a future per-cart instance.

## Portable import package

`prebuilt_bundle_import_package.v1` is the source-neutral interchange format for a future paid-app export adapter. It contains `import_id`, `source_records`, `mappings`, `pilot_scope`, and optional `source_export` provenance. The local package parser rejects malformed top-level structures and any `bundle_id` or `_bundle_id` key before the existing planner runs. It creates a deterministic package fingerprint for review artifacts.

The package format does not assume a particular paid application API or export file. A real source adapter must transform the vendor export into this canonical package and retain source provenance; it must not write Shopify data as part of parsing.

## Read-only source adapter boundary

`prebuilt-bundle-import.source-adapter.js` provides the local boundary for a future paid-app export adapter. A source-specific implementation supplies only a read-only `list_records({ cursor, page_size })` function and must return `{ records, next_cursor }`. Every record must already use `prebuilt_bundle_import_source.v1` and the adapter's declared `source_system`.

`collectPrebuiltBundleImportSourceRecords` preserves source order, freezes collected records, rejects malformed pages and repeated cursors, and applies a bounded maximum record count. It deliberately has no vendor SDK, Shopify client, persistence adapter, or write path. Source-specific authentication, API calls, rate limits, and export conversion remain a separately approved integration task once the current paid application's real export contract is available.

`createPrebuiltBundleImportPackageFromSource` composes that read-only collection with explicit `import_id`, mappings, and pilot scope into the existing validated portable package. It never infers target mappings or expands the pilot scope, so collection cannot create or publish a BundleDefinition by accident.

### Declarative JSON export intake

`prebuilt-bundle-import.declarative-source.js` provides the vendor-neutral intake
path while the paid application's exact export contract is still pending. A
`prebuilt_bundle_source_mapping.v1` profile maps explicit dot-separated object keys
for the source ID, optional vendor checksum, series key, parent Product/Variant GIDs,
and component Variant GIDs. It does not execute expressions, construct Shopify IDs,
coerce quantities, infer target mappings, or call Shopify.

Only complete Shopify Product and ProductVariant GIDs are accepted. The current
contract still requires every component quantity to equal `1`. Missing fields,
duplicate source IDs, unsafe paths, unsupported quantities, and malformed GIDs fail
before a dry-run plan is created. When no vendor checksum is available, the adapter
derives a deterministic checksum from the complete raw source record.

The adapter records fingerprints for both the mapping profile and the complete raw
export, plus the normalized record count. This provenance flows into
`source_export` and therefore into the portable package fingerprint. The example
profile is `docs/examples/prebuilt-bundle-source-mapping.example.json`; its JSON
Schema is `docs/schemas/prebuilt-bundle-source-mapping.v1.schema.json`.

The local command below prints normalized provenance and source records to stdout.
It deliberately rejects `--apply`, `--write`, and `--output`:

```text
npm run normalize:prebuilt-bundle-source -- --input <export.json> --mapping <mapping.json>
```

### Bundles.app Variant catalogue plus relationship capture

The current paid application has been identified as `Bundles.app - Inventory Sync`.
Its available CSV is a Shopify Variant catalogue, not a bundle-relationship export:
it contains SKU, title, Product ID, Variant ID, type, and status, but no component
relationship or quantity columns. One complete bundle relationship was therefore
captured from the paid-app detail screen without editing the source bundle.

`prebuilt-bundle-import.bundles-app-capture.js` combines that read-only Variant CSV
with an explicit `bundles_app_manual_capture.v1` document containing one parent SKU
and its ordered component SKU/quantity list. It resolves numeric Shopify IDs into
full GIDs, requires a unique CSV row for every referenced SKU, requires the parent to
be marked `BUNDLE`, rejects nested Bundles and quantities other than `1`, and emits
only canonical source records plus provenance fingerprints. It creates no target
mapping, Pilot Scope, persistence record, or Shopify write.

```text
npm run normalize:bundles-app-capture -- --variants-csv <variants.csv> --capture <bundle.json>
```

When a Shopify product export is also available, the same command accepts
`--products-csv <products.csv>`. It uniquely matches the parent and component SKUs,
reconciles the captured component subtotal and Bundle price in integer cents, and
emits `bundles_app_price_evidence.v1`. The evidence includes original Variant prices
and a deterministic proportional candidate allocation whose final-line delta makes
the allocation sum exactly to the Bundle price. This remains review evidence only;
it is not automatically converted into an executable target mapping.

The capture Schema and sanitized example are
`docs/schemas/bundles-app-manual-capture.v1.schema.json` and
`docs/examples/bundles-app-manual-capture.example.json`. This path proves a
repeatable single-bundle pilot intake; it does not claim that Bundles.app exposes a
full relationship export or that thousands of bundles can yet be migrated without
additional vendor data/API access.

### Bundles.app full catalogue workbook preflight

Josh's team supplied an internal Excel export containing complete `Bundle Contents`
relationships. The local `preflight-bundles-app-catalog.mjs` command combines that
workbook with the existing Shopify Variant CSV. It parses the ordered SKU/quantity
relationships, deduplicates only identical parent-SKU relationships, resolves full
Product/Variant GIDs, and classifies malformed content, conflicting duplicates,
missing/ambiguous identities, nested Bundles, inactive records, and unsupported
quantities. It never infers product-series keys, generates target mappings, or calls
Shopify.

```text
npm run preflight:bundles-app-catalog -- --xlsx <sku_pricing.xlsx> --variants-csv <variants.csv> --summary --output <new-local-report.json>
```

`--output` creates only a new local JSON report and refuses to overwrite an existing
file. `--apply`, `--write`, `--execute`, and `--shopify` are rejected.

The 2026-07-21 real preflight found 2,052 relationship rows and 1,554 unique parent
SKUs. All 498 duplicate parent SKUs had identical relationships; no malformed,
missing, ambiguous, nested-Bundle, or conflicting-relationship errors remained.
1,148 records are ready for target-mapping review. The remaining 406 records are
blocked only because they contain component quantities above `1`, which the current
fixed-selection contract intentionally rejects. Full evidence is recorded in
`docs/BUNDLES_APP_CATALOG_PREFLIGHT_2026-07-21.md`.

After target mappings and an approved Pilot Scope are prepared, the complete
raw-export-to-plan pipeline remains read-only:

```text
npm run plan:prebuilt-bundle-source-import -- --input <export.json> --source-mapping <source-map.json> --target-mappings <targets.json> --pilot-scope <pilot.json> --import-id <uuid>
```

The result contains the raw-export provenance, package fingerprint, deterministic
confirmation token, record-level mapping issues, and readiness summary. It rejects
`--apply`, `--write`, and `--execute`; execution remains a separate guarded command.

For large local reviews, `npm run plan:prebuilt-bundle-import -- --input <import-package.json>` reads one package and prints its dry-run plan. It has no `--apply` mode and never invokes Shopify CLI or a persistence adapter.

## Dry-run result

`createPrebuiltBundleImportPlan` is deterministic and write-free. It returns record-level status:

- `ready_for_confirmation`: mapping, pilot boundary, existing-parent ownership, configuration validity, and fixed-component parity all passed.
- `needs_review`: reserved for non-blocking review findings in future source adapters.
- `rejected`: one or more blocking issues, including missing mapping, invalid data, duplicate parent binding, out-of-pilot scope, or resolved component mismatch.

The plan includes an immutable source fingerprint, a target fingerprint over the
complete reviewed parent binding, Bundle Config V1 document, and fixed selections,
and a confirmation token bound to both fingerprints. Changing target configuration
after review therefore invalidates confirmation and idempotency. A plan never creates
a BundleDefinition, Revision, PublicationRecord, metafield, or Metaobject.

## Local execution contract

`executeConfirmedPrebuiltBundleImport` consumes only `ready_for_confirmation` records and requires the exact confirmation token generated by the reviewed plan. Its target creator and ledger are dependency-injected; the default local test ledger is in memory. The target creator receives the complete reviewed configuration. A repeated completed source fingerprint, target identity, and target fingerprint is skipped idempotently. Any changed source or target content is a `RETRY_CONFLICT`; it is never overwritten. Target-creator errors are recorded as failed for later recovery.

`assessPrebuiltBundleImportRecovery` is the corresponding read-only local recovery
assessment. A matching completed ledger record is idempotently complete. A matching
pending or failed record is never automatically re-run because the target writer may
have reached an external system before reporting an error; it is instead marked
`requires_target_reconciliation`. A changed source fingerprint, target identity, or
unknown ledger state is a blocking retry conflict. The assessment has no writer,
Shopify client, or target lookup implementation.

The execution contract is connected to the authenticated Bundle Admin
command and development Shopify persistence composition. It remains disabled by
default and is enabled only by the dedicated server-side environment gate.

`compilePrebuiltBundleImportTarget` now provides the pure boundary immediately
before persistence. It revalidates the reviewed target fingerprint and produces
the published Definition, Revision, Runtime Snapshot, runtime assignment, mapping,
and compact Checkout projection as one immutable payload. It performs no writes;
the remaining external boundary is persistence ordering and recovery ownership.

The local `createPrebuiltBundleImportTargetWriter` now connects confirmed import
execution to that compiler and a dependency-injected persistence adapter. Writes
follow a resumable order: staged Definition, immutable Revision, Snapshot,
projection, active pointer, activated Definition, then audit. Exact retries resume
or return idempotent success; any drift fails closed. Partial first-time resources
are never deleted automatically and are reported for exact retry or manual
reconciliation. The authenticated execution route can reach this writer only after
server-side package re-review, exact confirmation, and the dedicated opt-in gate.

The durable development ledger uses one app-owned Shop JSON metafield per source
identity. Its deterministic key uses a 128-bit truncated SHA-256 digest of the full source identity, and every
state transition uses Shopify `compareDigest` CAS. New entries must start at
`pending`; only `pending -> completed` or `pending -> failed` is allowed; terminal
records and source/target fingerprint bindings are immutable. Concurrent first
writes therefore fail closed before target creation. Exact completed retries are
returned as already complete.

## Current boundary

The production Cart Transform remains the hard-coded Shared Core authority. This
contract adds guarded Admin execution wiring, but it does not enable the gate by
default, expose an execution UI, deploy a Function, or change runtime authority. The
controlled rehearsal described below wrote only dedicated `aces_dev` rehearsal keys
and development Metaobjects; those records are not read by the active Function.

## Development-store rehearsal evidence — 2026-07-20

The approved rehearsal ran against `cart-transform-poc-dev` on
`huang-mvqquz1p.myshopify.com`, using API `2026-04` and isolated carriers:

- `aces_dev.bundle_runtime_snapshot_import_rehearsal_v1`
- `aces_dev.prebuilt_expand_projection_import_rehearsal_v1`
- `aces_dev.active_revision_id_import_rehearsal_v1`
- `aces_dev.prebuilt_import_rehearsal_v1_*`

The successful record durably persisted Definition `...0062`, published Revision
`...0063`, Runtime Snapshot checksum `5fc86e38`, projection checksum `9afd613d`,
active pointer, immutable publication record `...0064`, and a completed Shop ledger.
A second exact invocation returned `already_completed` without recreating target
resources. Read-back after a stale-ledger write attempt confirmed that the completed
ledger remained unchanged.

The retained failure record Definition `...0032` contains only a staged Definition
with `active_revision_id: null`; it has no Revision, Snapshot, projection, active
pointer, or publication record. Its failed ledger is classified
`requires_target_reconciliation`, and automatic retry is blocked. This is the live
partial-write recovery boundary required by the contract.

The rehearsal used batched mutation fields to reduce Shopify CLI transport calls.
This is a rehearsal transport optimization only; the application target writer keeps
its resumable ordered-write implementation and fail-closed recovery rules.

## Next implementation boundary

The controlled development-store import rehearsal, single-bundle pilot import, and
full-catalogue relationship/Variant preflight are complete. The next local boundary
is target-mapping and price-evidence preparation for the 1,148 quantity-one records.
The 406 repeated-quantity records require a V5.5-or-newer proposal before runtime
changes. The live pilot still requires Cart -> Checkout -> Order -> Inventory and
fulfillment evidence. Generic projection promotion, production data migration, and
broader runtime rollout remain separately approved phases.

The maintained incomplete-work register is
`docs/PREBUILT_PILOT_OUTSTANDING_WORK_2026-07-20.md`. It is the operational checklist
for real export intake, Sealos release, formal Cart/Checkout/Order/inventory evidence,
Collective semantics, cleanup, rollback, and production readiness.

The local pilot evidence checker is
`scripts/check-prebuilt-bundle-pilot-acceptance.mjs`. Its evidence document binds the
approved parent/component quantities to Cart, Checkout, Order, inventory, fulfillment,
and rollback observations. It reports `invalid`, `incomplete`, `failed`, or `passed`
and has no Shopify transport or mutation path.
The machine-readable evidence shape is fixed by
`docs/schemas/prebuilt-bundle-pilot-acceptance.v1.schema.json`; start from
`docs/examples/prebuilt-bundle-pilot-acceptance.template.json` and replace every
placeholder before evaluation.
