# Changelog

This changelog records project-level milestones. Shopify template upstream
changes are not part of this repository's release history.

## Current development baseline

- Bundle Admin Polaris MVP is available for development-store configuration,
  draft editing, validation, compile preview, and active-revision comparison.
- Production Cart Transform authority remains the hard-coded Shared Core.
- Development-only Shopify persistence uses guarded Metaobjects and product
  metafields; publishing is not exposed in the Admin UI.
- Sealos app-server releases, Shopify Function deployments, and Theme App
  Extension deployments remain separate operations.

## Accepted architecture

- Cart contains one Master Kit parent line.
- Checkout and Orders expand into component lines.
- Inventory deducts components only.
- Bundle Metadata V1 and dedicated Builder template isolation are preserved.

See [Project_Master_Context_V5.3_Current_Baseline.md](./Project_Master_Context_V5.3_Current_Baseline.md)
for the authoritative engineering baseline.
