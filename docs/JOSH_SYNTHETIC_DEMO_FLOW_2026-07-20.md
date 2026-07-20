# Josh Synthetic Demo Flow — 2026-07-20

Status: locally implemented; not yet released to Sealos. This flow uses synthetic
data only and does not create products, change inventory, publish a Function, or
persist an import.

## Intended walkthrough

1. Open **Bundle Admin → Review pre-built import**.
2. Select **Load demo data (no writes)**.
3. Review the prefilled raw paid-app-style JSON, mapping profile, target mapping,
   and pilot scope.
4. Select **Normalize and review**.
5. Confirm the dry-run result contains one record marked
   `ready_for_confirmation`, source/package fingerprints, and `No writes`.

## Deliberate limits

- The demo reuses verified development-store fixture GIDs but submits no mutation.
- Import execution remains disabled and is not exposed by this walkthrough.
- Storefront Cart/Checkout can still be demonstrated separately with the existing
  verified test bundle; this synthetic import review does not alter that bundle.
- Josh must not treat the synthetic source format as evidence of compatibility with
  the paid Bundles application. A real sanitized export is still required.

## Required before Josh can access it

- Approve the accumulated local batch for commit/push and Sealos development-app
  release.
- Verify `/healthz` and the embedded Admin route after the new Pod starts.

The English participant walkthrough is in
`JOSH_DEMO_SCRIPT_EN_2026-07-20.md`. Huang's release-day checklist is in
`JOSH_DEMO_OPERATOR_CHECKLIST_ZH_2026-07-20.md`.
