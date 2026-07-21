# ACES Shopify Bundle Builder — Project Progress for Josh

Date: July 20, 2026

Update — July 21, 2026: the internal `sku_pricing.xlsx` export has now been processed
against the Shopify Variant catalogue. It contains 2,052 relationship rows and 1,554
unique parent SKUs. All 498 duplicate parent SKUs have identical component
relationships, so no relationship conflict was found. Variant identity resolution
also completed with no missing or ambiguous parent/component SKUs. Under the current
quantity-one runtime contract, 1,148 Bundles are ready for target-mapping review and
406 are blocked because they contain `x2`, `x4`, or `x8` components. Those repeated
quantities require a separately reviewed runtime proposal; they were not silently
flattened or changed.

## Executive summary

The project is moving in the intended Option C direction:

- The storefront cart keeps one main kit SKU.
- Checkout and Orders expand the kit into its component SKUs.
- Inventory is intended to be deducted from components, not from the parent kit.
- The implementation does not depend on Shopify's native Bundle relationship, which
  is the relationship currently conflicting with Combined Listings and preventing
  some product edits such as image, price, and Compare-at price changes.

The original three-component development test has already displayed correctly in
Checkout. We have now completed the next milestone: importing one real bundle sample
from the current Bundles.app data into the development environment.

## Completed

1. Built the embedded Bundle Admin foundation for managing bundle definitions and
   revision history inside Shopify Admin.
2. Implemented the locked cart/checkout architecture and its local safety gates.
3. Added a Bundles.app intake workflow that combines the Shopify Variant CSV with a
   captured parent/component relationship and converts it into the project's bundle
   format.
4. Imported the real sample bundle
   `AS2212CG2-MK-2011-4005P` into the development store:
   - one parent Variant;
   - thirteen component Variants;
   - exact bundle total of USD 1,389.99;
   - seven isolated pilot products created, with two existing component Variants reused.
5. Verified the persisted BundleDefinition, active revision, runtime snapshot,
   pre-built expansion projection, publication audit, and import ledger by reading
   them back from Shopify.
6. Verified import idempotency: repeating the same import reports
   `already_completed` and does not create duplicate revisions.
7. Fixed and regression-tested an import recovery issue involving JSON fields omitted
   by Shopify persistence.
8. Passed the full local validation suite: 60 test files and 407 tests, local build,
   Function profile restoration, and production-clean checks.

## Current test boundary

The imported pilot data is available in the development store and Bundle Admin, but
the new parent product has not been published to the Online Store. We also did not
deploy or switch the Cart Transform Function during this import milestone. No
production store, production app, production inventory, or real orders were touched.

## Next milestones

1. Capture the pilot's pre-test inventory and active development Function evidence.
2. Publish only the pilot parent to the development sales channel.
3. Validate the complete flow:
   - one parent line in Cart;
   - thirteen expanded components in Checkout;
   - expected component lines in Order Admin;
   - zero parent inventory deduction;
   - correct component inventory deductions.
4. Validate rollback and operational monitoring.
5. Design and approve the production migration and rollout after the development
   acceptance evidence passes.

## Decisions or information still needed

1. Shopify Collective capability: the preferred supplier-side behavior is component
   expansion, but Josh believes Collective may not support it. We need live capability
   evidence and should retain main-SKU-only pass-through as the fallback.
2. Repeated component quantities: 406 exported Bundles require quantities above one.
   We need to prioritize whether this support is required for the first rollout before
   extending the currently verified quantity-one runtime.
3. Pilot owner, test window, rollback owner, and permission to run the development
   Cart/Checkout/Order/inventory acceptance test.

## Overall status

The local implementation and single-bundle development-store import milestone are
complete. The project is now at the controlled end-to-end pilot stage. Production
runtime authority remains unchanged until the development acceptance and rollback
evidence are complete and separately approved.
