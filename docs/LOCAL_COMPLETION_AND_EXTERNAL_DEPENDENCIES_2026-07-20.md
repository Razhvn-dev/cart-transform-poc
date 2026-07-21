# Local Completion and External Dependencies — 2026-07-20

Status: local-first work has been completed as far as current repository evidence
allows. This document does not authorize Shopify writes, deployment, commit, push,
production work, or a runtime authority switch.

End-of-day checkpoint: engineering work paused after the development-store import,
durable read-back, idempotency verification, documentation update, and full local
validation completed on 2026-07-20. The stakeholder-facing handoff is
`docs/JOSH_PROJECT_PROGRESS_2026-07-20.md`.

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
- A development-store-only clone of the captured real bundle: seven isolated pilot
  products, fourteen uniquely resolved parent/component Variants, one active
  BundleDefinition revision, runtime snapshot, pre-built projection, publication
  audit, and completed idempotency ledger. The imported package has 13 components
  and an exact USD 1,389.99 allocated total.
- Full-catalogue Bundles.app relationship preflight: 2,052 source rows, 1,554 unique
  parent SKUs, 498 exact duplicates, 1,148 quantity-one records ready for mapping,
  and 406 repeated-quantity records failed closed for later architecture review.
- Development-store real catalogue import and cleanup: Shopify Admin successfully
  imported 235 products / 5,644 preview-reported SKUs; 23 obsolete test products
  were removed while six POC regression products were retained. The verified final
  count is 241 products. See
  `docs/DEV_STORE_CATALOG_IMPORT_AND_CLEANUP_2026-07-21.md`.

## Waiting for external information

1. Formal acceptance owner, rollback window, and test inventory baseline for the
   imported development pilot package.
2. Relationship-owner App for legacy native Bundle products.
3. Live Shopify Collective capability evidence. Josh's preferred behavior is
   component expansion, with main-SKU-only pass-through as the likely fallback.
4. Product/operations priority for the 406 repeated-quantity source Bundles before a
   V5.5 quantity-support proposal is scheduled.

## Waiting for explicit authorization

1. Read-only capture of development-store inventory, active Function version,
   Cart Transform binding, and Function input evidence before runtime testing.
2. Sealos/Devbox release and real embedded Bundle Admin regression.
3. Owner-App Unlink cleanup of existing native Bundle relationships.
4. Development-store sales-channel publication plus Cart, Checkout, Order, inventory,
   fulfillment, and rollback pilot.
5. Commit, push, Function deployment, production resource creation, migration, and rollout.

## Commands prepared for later evidence

```text
npm run normalize:prebuilt-bundle-source -- --input <export.json> --mapping <mapping.json>
npm run normalize:bundles-app-capture -- --variants-csv <variants.csv> --capture <bundle.json>
npm run preflight:bundles-app-catalog -- --xlsx <sku_pricing.xlsx> --variants-csv <variants.csv> --summary --output <new-local-report.json>
npm run plan:prebuilt-bundle-source-import -- --input <export.json> --mapping <mapping.json> --targets <targets.json>
npm run diagnose:native-bundle-conflicts:dev-read-only -- --product-id gid://shopify/Product/<id>
npm run plan:native-bundle-migration -- --input <inventory.json>
npm run check:native-bundle-migration -- --input <evidence.json>
npm run check:prebuilt-bundle-pilot -- --input <evidence.json>
npm run check:local-release-candidate
```

The single captured paid-App bundle has been imported and read back from the
development store. Until the remaining inputs or approvals exist, claims about
full-catalogue compatibility, legacy relationship ownership, Collective behavior,
or end-to-end storefront/order behavior would still be assumptions rather than
verified engineering evidence.
