# Shopify Persistence Feasibility V1

This is a local feasibility record. It performs no Admin GraphQL mutation and creates no
Shopify data.

| Domain record | Candidate resources | Recommended boundary |
| --- | --- | --- |
| BundleDefinition | App-owned Metaobject, app backend database | App-owned Metaobject |
| BundleRevision | App-owned Metaobject, app backend database | App-owned Metaobject |
| Runtime Snapshot V1 | Parent-product app-owned JSON metafield | Parent-product app-owned JSON metafield |
| `active_revision_id` | Parent-product app-owned metafield, BundleDefinition field | Parent-product app-owned metafield |
| PublicationRecord | App-owned Metaobject, app backend database | App-owned Metaobject; database if operational audit requirements exceed Shopify-only guarantees |

`metafieldsSet` supports atomic writes within one mutation and `compareDigest` CAS for each
metafield. The adapter must read the digest before write, set `compareDigest` to the expected
digest (or `null` for safe creation), then read back Snapshot checksum/version. See Shopify's
[metafieldsSet CAS documentation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldsSet?example=updates-a-metafield).

`metaobjectUpdate` accepts an ID and field values but its documented input does not expose a
`compareDigest` equivalent. Treat Metaobject edits as optimistic reads followed by write and
post-write verification, not true CAS. See [metaobjectUpdate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/metaobjectUpdate).

No Shopify transaction spans Metaobjects and product metafields. Snapshot write/read-back,
active pointer CAS, and publication audit recording therefore remain staged operations with
compensation. Product metafields are the correct Runtime Snapshot carrier because Functions can
query resource metafields; app-owned Metaobjects are also Function-queryable, but this project
retains the accepted Runtime Snapshot V1 product-metafield contract. [Function metafield input](https://shopify.dev/docs/apps/build/functions/input-queries/metafields-for-input-queries)
