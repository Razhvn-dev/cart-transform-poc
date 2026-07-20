# Development Publication Rehearsal Incident - 2026-07-17

## Scope

This was an explicitly approved development-only persistence rehearsal against
`cart-transform-poc-dev` / `huang-mvqquz1p.myshopify.com` with Admin API
`2026-04`. It did not deploy an app or Function.

The rehearsal used only these isolated carriers:

- `aces_dev.bundle_runtime_snapshot_publication_rehearsal_v1`
- `aces_dev.active_revision_id_publication_rehearsal_v1`

It did not read or write `aces_dev.bundle_runtime_snapshot_v1`,
`aces_dev.active_revision_id_v1`, `aces_dev.bundle_runtime_snapshot_test`,
production resources, Cart Transform registration, the theme, Builder, or the
Custom Distribution App.

## Evidence

The Shopify CLI request to:

`https://huang-mvqquz1p.myshopify.com/admin/api/2026-04/graphql.json`

ended with `socket hang up` during the `domain_lifecycle_write` step. The
failed request was an isolated baseline BundleRevision read-after-write.

The single read-only reconciliation after that failure confirmed:

| Resource | Confirmed state |
| --- | --- |
| Definition handle `e9011d4e-5a14-4e0d-9000-000000000000` | exists; `active_revision_id: null` |
| Baseline Revision handle `e9011d4e-5a14-4e0d-9000-000000000001` | exists; still `draft` |
| Candidate Revision | absent |
| Baseline/Candidate/Rollback PublicationRecord | absent |
| Isolated Snapshot | exists; checksum `23143031`, configuration version `1` |
| Isolated active pointer | baseline revision ID; compareDigest recorded by reconciliation |

## Safety Decision

This is not a successful publication rehearsal. It is also not safe to retry
blindly: the external pointer no longer matches the Definition, while Shopify
does not offer a compare-and-set delete for a missing product metafield and
the current pointer adapter does not represent a null-target restore.

Leave the isolated resources in place. They are not queried by the Function or
the Admin editing surface and have no checkout impact.

## Required Recovery Before Retry

1. Read the isolated Definition, Revision, Snapshot, pointer, and all three
   rehearsal publication handles in one Admin API `2026-04` query.
2. Require exact identity, checksum, configuration version, and compareDigest
   matches to the table above.
3. Review and approve one explicit recovery policy: either complete the known
   baseline domain/audit transaction or add a tested, CAS-protected null-pointer
   restoration capability. Do not use an unconditional overwrite or delete.
4. Read back the final isolated state before attempting candidate publication,
   idempotency, stale-CAS, or rollback validation.

## Recovery Result

The evidence-bound recovery was executed on 2026-07-17. Shopify CLI had
additional transient TLS/socket failures during individual read-back requests,
but each uncertain write was followed by a separate read-only reconciliation.
The final confirmed isolated state is:

| Resource | Final confirmed state |
| --- | --- |
| Definition | `active_revision_id` is baseline revision `...0001` |
| Baseline Revision | `published`, with Runtime Snapshot ref checksum `23143031` |
| Baseline PublicationRecord | exists and matches the recovery audit record |
| Candidate Revision / PublicationRecord | absent |
| Rollback PublicationRecord | absent |
| Isolated Snapshot | checksum `23143031`, compareDigest `c3e2baad41a37563ac4a9968600fa1998f941e4e66b597d6ef401b9c6c7e13be` |
| Isolated active pointer | baseline revision `...0001`, compareDigest `607f08ec5e636eed01d9370eaf09f0e94fc0dc30f810eefec803f3dfe37e74b5` |

No primary dev carrier, production resource, Cart Transform registration,
theme, Builder, product, or Custom Distribution App resource was accessed.

The remaining rehearsal must use resumable, evidence-bound stages for the
candidate publication, idempotent retry, stale CAS check, and rollback. Do not
use the original all-in-one execution path while Shopify CLI connectivity is
intermittent.

## Candidate Stage Preparation

A separate candidate-stage state machine and isolated draft-seed command were
added locally. The first attempted candidate seed stopped at its initial
read-only reconciliation because the Shopify CLI Admin API request ended with
`socket hang up`. No candidate Metaobject mutation was sent, so the last
confirmed remote state remains the recovered baseline described above.

## Transport Hardening

The isolated rehearsal commands now use one shared CLI executor. It applies a
45-second command timeout and at most one delayed retry to a GraphQL `query`
that fails with a known transient TLS/socket error. GraphQL mutations are never
retried automatically: a transport failure leaves their remote result unknown,
so the next permitted action remains an exact read-only reconciliation.

This change does not make a Shopify write, does not alter the rehearsal state,
and does not change the primary development Snapshot/pointer or Function
authority. It only limits the impact of a transient Shopify CLI connection
failure on future approved isolated stages.
