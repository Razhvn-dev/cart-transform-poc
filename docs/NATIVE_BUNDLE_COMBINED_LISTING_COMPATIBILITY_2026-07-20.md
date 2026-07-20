# Native Bundle and Combined Listing Compatibility — 2026-07-20

Status: local prevention and read-only diagnosis implemented. No Shopify cleanup,
product edit, deployment, or external mutation was performed.

## Confirmed problem

Shopify native bundle relationships (`requiresComponents` and
`productVariantComponents`) conflict with Combined Listing parent/child products.
The historical `seed-test-products.mjs` created these relationships even though the
locked Option C architecture uses Cart Transform `expand` instead.

## Local fix

- The seed script no longer sets `requiresComponents` or calls
  `productVariantRelationshipBulkUpdate`.
- Read-only queries may retry; seed mutations execute only once because a transport
  failure leaves the remote outcome unknown.
- A regression test prevents the prohibited native relationship tokens from returning.
- A read-only development-store diagnostic reports Combined Listing role,
  `requiresComponents`, and component relationship counts:

  ```text
  npm run diagnose:native-bundle-conflicts:dev-read-only -- --product-id gid://shopify/Product/<id>
  ```

## Cleanup boundary

This change prevents new conflicts but does not silently unlink existing products.
Shopify restricts native component management to the owning application. Existing
relationships must first be diagnosed and then removed through the owner App's
approved Unlink workflow. After cleanup, separately verify image, price, and
Compare-at price persistence plus Cart and Checkout behavior.

## Local migration workflow

The migration workflow is prepared without exposing a Shopify mutation:

1. Save the read-only Product evidence in the inventory template and identify
   the App that owns each native relationship.
2. Generate a deterministic migration plan:

   ```text
   npm run plan:native-bundle-migration -- --input <inventory.json>
   ```

3. After a separately approved owner-App cleanup and manual product/runtime
   validation, fill the acceptance template and run:

   ```text
   npm run check:native-bundle-migration -- --input <evidence.json>
   ```

The planner and checker reject `--apply`, `--write`, `--execute`, and `--unlink`.
Templates are stored in `docs/examples/native-bundle-migration-*.template.json`.
