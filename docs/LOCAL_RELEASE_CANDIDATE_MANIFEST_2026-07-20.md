# Local Release Candidate Manifest — 2026-07-20

Status: structurally ready for release review, not authorized for commit, push,
deployment, Shopify writes, or production authority changes.

## Included local scope

- Bundle Admin structured editing, persistence hardening, read-back verification,
  normalized retry/error behavior, and health endpoint.
- Synthetic pre-built import review, vendor-neutral JSON mapping, deterministic
  planning, target persistence, recovery, and pilot evidence contracts.
- Development-only Runtime Snapshot observation/candidate tooling with production
  Shared Core isolation and fail-closed gates.
- Native Bundle/Combined Listing conflict prevention, diagnosis, migration planning,
  and post-cleanup acceptance checking.
- Josh demonstration script, operator checklist, release workflow, outstanding work,
  and production-readiness documentation.

## Explicit exclusions

- `shopify.app.local.toml`, `.env*`, private keys, certificates, and Word exports.
- Custom Distribution App changes and `shopify.app.toml` changes.
- Shopify product, inventory, Metaobject, metafield, Cart Transform, or Function writes.
- Real paid-App compatibility claims without a sanitized export.
- Runtime authority promotion or production rollout.

## Automated structural gate

Run:

```text
npm run check:local-release-candidate
```

The checker is read-only. It verifies required release files and package scripts,
rejects local config/secrets/Custom Distribution config, checks that the seed path
does not recreate Shopify native Bundle relationships, and reports the dirty-tree
scope by area. It always reports `ready_to_deploy: false`; release approval remains
an external gate.

## Known review warnings

- The working tree contains a large accumulated batch and must be reviewed by area
  before staging. Do not stage everything blindly.
- `AGENTS.md.txt` is currently deleted while `AGENTS.md` is modified. This is a
  pre-existing working-tree state and must be intentionally included or excluded
  during the future commit review; this batch did not restore or delete either file.

## Required release-review sequence

1. Run full local validation and the release-candidate checker.
2. Review changed files by `app`, `extensions`, `scripts`, `docs`, `tests`, and root.
3. Confirm no user-owned change is overwritten or omitted.
4. Obtain explicit commit/push/development release approval.
5. Release only `cart-transform-poc-dev` through the approved workflow.
6. Verify Pod start, `/healthz`, embedded Admin, synthetic demo, Cart, and Checkout.
7. Record live evidence separately; local success is not deployed-state evidence.
