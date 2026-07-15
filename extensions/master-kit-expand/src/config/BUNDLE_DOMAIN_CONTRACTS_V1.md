# Bundle Domain Contracts V1

These contracts are local-only domain records. They do not create Shopify Metaobjects,
metafields, publication writes, or Builder projections.

`bundle_definition_id` is the stable configuration identity. `_bundle_id` is not valid in
any domain record because it remains the Bundle Metadata V1 UUID for one cart bundle instance.

## BundleDefinition

```json
{
  "schema_version": "bundle_definition.v1",
  "bundle_definition_id": "UUID",
  "slug": "aces-master-kit",
  "parent_binding": {
    "product_gid": "gid://shopify/Product/…",
    "variant_gid": "gid://shopify/ProductVariant/…"
  },
  "active_revision_id": "UUID or null",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

`active_revision_id` is the only active pointer. A parent variant can bind to one
BundleDefinition only. It must point to a `published` revision for the same definition.

## BundleRevision

```json
{
  "schema_version": "bundle_revision.v1",
  "revision_id": "UUID",
  "bundle_definition_id": "UUID",
  "revision_number": 2,
  "status": "draft | published | superseded | archived",
  "configuration": "Bundle Config V1 document",
  "runtime_snapshot_ref": {
    "schema_version": "bundle_runtime.v1",
    "checksum_algorithm": "fnv1a-32",
    "checksum": "8 hex characters",
    "configuration_version": 2
  },
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "created_by": "actor"
}
```

Draft revisions are editable only through `updateDraftRevision`. Published, superseded,
and archived revisions are immutable. A changed published configuration is represented by a
new draft with a higher `revision_number`.

## PublicationRecord / Publication Attempt

```json
{
  "schema_version": "bundle_publication_attempt.v1",
  "publication_id": "UUID",
  "bundle_definition_id": "UUID",
  "revision_id": "UUID",
  "revision_number": 2,
  "retry_identity": "definition-id:revision-id:checksum",
  "attempt_number": 1,
  "state": "pending | compiled | snapshot_written | snapshot_verified | active_pointer_updated | recorded | failed | compensating | compensated",
  "runtime_snapshot_ref": "Runtime Snapshot reference",
  "previous_active_revision_id": "UUID or null",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

The retry identity is stable across retries of the same compiled Snapshot. State transitions
model the staged publication flow. This Phase has no Shopify persistence or publication.

## Local Staged Publication Service

`bundle-publication.service.js` is a pure orchestrator. It compiles a draft, runs Runtime
Snapshot checksum/size gates and the existing result comparator, then invokes injected
dependencies for Snapshot writes, read-back, active-pointer compare-and-set, audit recording,
and compensation. `bundle-publication.in-memory-driver.js` is a test-only simulation of those
dependencies. Neither module calls Shopify APIs or writes metafields or Metaobjects.

Successful publication records are idempotent by `publication_id`. Failures after a Snapshot
write restore the previous validated Snapshot; failures after a pointer attempt also use a
compare-and-set restore. A failed compensation is returned explicitly and never represented as
a successful publication.
