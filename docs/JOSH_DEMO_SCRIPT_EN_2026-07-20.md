# ACES Bundle Project — Josh Demo Script

Status: prepared for the development-app release. The import example is synthetic
and write-free. It demonstrates the intended workflow, not compatibility with the
company's current paid Bundles App.

## Part 1 — Review a pre-built Bundle import

1. Open `cart-transform-poc-dev` in Shopify Admin.
2. Select **Open Bundle Admin**.
3. Open **Pre-built import review**.
4. Select **Load demo data (no writes)**.
5. Review the populated source export, mapping profile, target mapping, and pilot scope.
6. Select **Normalize and review**.

Expected result:

- The page displays **Dry-run result** and **No writes**.
- Total is `1`, Ready is `1`, Needs review is `0`, and Rejected is `0`.
- The record status is `ready_for_confirmation`.
- Source and package fingerprints are displayed.
- No product, inventory, Bundle definition, or Shopify Function is changed.

## Part 2 — Review Bundle configuration management

1. Return to **Bundle configurations**.
2. Open an existing test Bundle.
3. Review its parent binding, active revision, draft history, Groups, Options,
   Presets, and Compatibility Rules.
4. Do not publish or run a production migration during this demo.

Expected result:

- Existing configuration and revision history can be inspected.
- Draft validation and compile preview remain separate from publication.
- Runtime publication is unavailable by default and fails closed.

## Part 3 — Storefront behavior

Use the existing approved test Bundle in the development store:

1. Clear the cart.
2. Add one Bundle parent product.
3. Confirm the Cart drawer shows one parent SKU line.
4. Continue to Checkout.
5. Expand the Checkout item details.

Expected result:

- Cart contains one parent line rather than separate component lines.
- Checkout expands the Bundle into the expected component SKUs.
- This project does not require Shopify native Bundle relationships on the product.

## Decisions still requested from Josh

1. Name of the paid Bundles App currently used by the company.
2. One sanitized JSON or CSV export from that App.
3. For Shopify Collective, whether supplier handling should remain main-SKU-only
   or use component-level inventory and fulfillment.

These inputs affect real-data mapping and fulfillment acceptance. They do not
change the locked Cart Transform architecture demonstrated above.
