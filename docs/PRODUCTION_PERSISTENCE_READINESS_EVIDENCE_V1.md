# Production Persistence Readiness Evidence V1

This is a local-only gate checker. It does not authenticate with Shopify, call
Shopify CLI, read secrets, create resources, write metafields, or switch
Runtime Snapshot authority.

## Use

Create an approved evidence JSON outside version control, then run:

```bash
npm run check:production-persistence-readiness -- --input <evidence.json>
```

The command exits non-zero when required evidence is missing. A passing result
only means the supplied local evidence is complete; it is not production-write
approval and does not replace live read-back or browser validation.

## Required evidence

- Target app, store, API version, config, and read-only identity confirmation.
- Explicit written production-write approval and timestamp.
- Every local validation result, including production-clean.
- Approved production resource names, access review, and `compareDigest`
  verification.
- For P2 and later: prior Function, Snapshot, pointer, rollback owner, and
  compensation-runbook evidence.
- For P3 and later: exact parity evidence bound to one Definition, Revision,
  Snapshot checksum, and fixture set.
- For P4 only: Browser -> Cart -> Checkout, Order -> Inventory, and hard-coded
  rollback regression evidence.

The checker rejects `aces_dev`, `_dev`, development app/config tokens, any
Runtime Snapshot authority switch, and any Custom Distribution App activity.
