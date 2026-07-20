# Local Completion and External Dependencies — 2026-07-20

Status: local-first work has been completed as far as current repository evidence
allows. This document does not authorize Shopify writes, deployment, commit, push,
production work, or a runtime authority switch.

## Completed locally

- Vendor-neutral JSON export normalization through an explicit data-only mapping profile.
- Deterministic pre-built import planning, package fingerprints, target persistence
  model, idempotency, partial-write recovery classification, and synthetic Admin demo.
- Cart, Checkout, Order, inventory, fulfillment-decision, and rollback pilot evidence checker.
- Native Bundle conflict prevention in the historical seed path.
- Read-only native Bundle/Combined Listing diagnostic.
- Batch native Bundle migration planning with relationship-owner enforcement.
- Post-cleanup acceptance checker covering native state removal, image, price,
  Compare-at price, Combined Listing editing, Cart, Checkout, and pilot evidence.
- Production persistence readiness and fail-closed authority gates.
- Full local tests, build, Function profile restoration, and production-clean checks.
- Read-only local release-candidate structural checker and release manifest.
- Josh English demo script and Huang Chinese operator/acceptance checklist.

## Waiting for external information

1. Current paid Bundles App name and one sanitized real JSON/CSV export.
2. Mapping confirmation for its parent IDs, component IDs, quantities, package identity,
   and any option/variant representation.
3. Real pilot product series, Product/Variant GIDs, expected components, and quantities.
4. Relationship-owner App for legacy native Bundle products.
5. Josh's Shopify Collective decision: main-SKU-only or component-level supplier handling.

## Waiting for explicit authorization

1. Read-only capture of development-store product, inventory, active Function version,
   Cart Transform binding, and Function input evidence.
2. Sealos/Devbox release and real embedded Bundle Admin regression.
3. Owner-App Unlink cleanup of existing native Bundle relationships.
4. Development-store Cart, Checkout, Order, inventory, fulfillment, and rollback pilot.
5. Commit, push, Function deployment, production resource creation, migration, and rollout.

## Commands prepared for later evidence

```text
npm run normalize:prebuilt-bundle-source -- --input <export.json> --mapping <mapping.json>
npm run plan:prebuilt-bundle-source-import -- --input <export.json> --mapping <mapping.json> --targets <targets.json>
npm run diagnose:native-bundle-conflicts:dev-read-only -- --product-id gid://shopify/Product/<id>
npm run plan:native-bundle-migration -- --input <inventory.json>
npm run check:native-bundle-migration -- --input <evidence.json>
npm run check:prebuilt-bundle-pilot -- --input <evidence.json>
npm run check:local-release-candidate
```

Until those inputs or approvals exist, further claims about the paid App format,
legacy relationship ownership, Collective behavior, or live Shopify behavior would
be assumptions rather than verified engineering evidence.
