# Shopify Dev Persistence Adapter V1

`shopify-dev-persistence.adapter.js` is an unbound, development-app-only Admin GraphQL adapter.
It accepts only the `cart-transform-poc-dev` Client ID and uses `aces_dev` bindings. It creates no
Metaobject definitions, metafield definitions, records, or Snapshots on construction.

| Domain method | Dev-only carrier | Concurrency boundary |
| --- | --- | --- |
| BundleDefinition | `$app:aces_bundle_definition_dev` Metaobject, `document` JSON field | read/update/read-back only |
| BundleRevision | `$app:aces_bundle_revision_dev` Metaobject, `document` JSON field | read/update/read-back only |
| PublicationRecord | `$app:aces_bundle_publication_record_dev` Metaobject, `document` JSON field | handle-based idempotency |
| Runtime Snapshot | product `aces_dev.bundle_runtime_snapshot_v1` JSON metafield | `metafieldsSet.compareDigest` |
| active revision | product `aces_dev.active_revision_id_v1` text metafield | `metafieldsSet.compareDigest` |

The adapter and staged publication orchestrator are asynchronous. The local
`bundle-publication.persistence-driver.js` bridges the normalized adapter to the orchestrator,
including external active-pointer reads, Snapshot checksum CAS, lifecycle Metaobject writes, and
compensation writes. The orchestrator still has no HTTP command or UI trigger, so it cannot
publish from the Bundle Admin. None of these modules is wired into Cart Transform, and all are
excluded from production Function entries and artifacts.

The `$app:` prefix makes the three Metaobject definitions app-owned by `cart-transform-poc-dev`.

Shopify has no compare-and-set metafield delete. Compensation that would restore a missing
Snapshot is rejected as `UNSUPPORTED_CAPABILITY`; a later publication integration must establish
an initial recoverable Snapshot before it enables that flow.
