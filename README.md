# ACES Shopify Bundle Builder

This repository contains the ACES Shopify Bundle Builder and its Cart Transform
proof of concept. The project includes:

- a Polaris embedded Bundle Admin for development-only bundle configuration;
- the shared bundle compiler and Runtime Snapshot V1 modules;
- a Shopify Function that keeps the production authority on the hard-coded
  Shared Core result;
- the Builder Theme App Extension and the Cart Transform Function.

The accepted runtime architecture is locked: Cart contains one Master Kit
parent line, while Checkout and Orders expand into component lines. Do not use
`lineUpdate` or runtime `productVariantComponents`.

## Current status

The current engineering baseline is documented in
[`Project_Master_Context_V5.3_Current_Baseline.md`](./Project_Master_Context_V5.3_Current_Baseline.md).
Production Function authority remains hard-coded. Bundle Admin publishing is
not exposed; the Admin UI currently edits and previews development-only draft
revisions.

## Prerequisites

- Node.js and npm
- Shopify CLI
- access to the development store
  `huang-mvqquz1p.myshopify.com`

Install dependencies and prepare the local Prisma client:

```powershell
npm install
npm run setup
```

## Local development

For the authenticated embedded Admin preview, use the Shopify CLI workflow:

```powershell
npm run dev:local
```

For a web-only Remix check that does not contact Shopify:

```powershell
npm run dev:web
```

The local workflow and its boundaries are documented in
[`docs/LOCAL_ADMIN_DEVELOPMENT.md`](./docs/LOCAL_ADMIN_DEVELOPMENT.md).

## Validation

Run the normal local validation before asking for a release:

```powershell
npm test
npm run lint
npm run build
npm run test:function
npm run validate:local
npm run assert:function:production-clean
```

`validate:local` builds both the development and production Function profiles
and restores/checks the production artifact. A passing local build does not
deploy anything.

## Release boundaries

The authorized development app is `cart-transform-poc-dev`. The Custom
Distribution App `cart-transform-poc` is out of scope unless explicitly
approved.

App-server releases and Shopify Function/Theme Extension deployments are
separate operations. For the Devbox-backed app-server process, follow
[`docs/SEALOS_DEVBOX_RELEASE_WORKFLOW.md`](./docs/SEALOS_DEVBOX_RELEASE_WORKFLOW.md).
For the approval boundary and release checklist, see
[`DEPLOY.md`](./DEPLOY.md).

Do not commit `shopify.app.local.toml`, secrets, generated build directories,
temporary probes, or machine-specific configuration.

## Persistence

The app currently uses Prisma session storage backed by SQLite. Bundle Admin
development persistence uses the guarded Shopify dev-only Metaobjects and
product metafields described in the current baseline. This is not a production
persistence rollout. Before a long-lived production deployment, choose a
persistent database strategy for app sessions and define a separate production
bundle publication plan.

## Project documentation

- [Current engineering baseline](./Project_Master_Context_V5.3_Current_Baseline.md)
- [Bundle Admin API](./app/domains/bundle-admin/BUNDLE_ADMIN_BACKEND_API_V1.md)
- [Local Admin development](./docs/LOCAL_ADMIN_DEVELOPMENT.md)
- [Devbox/Sealos release workflow](./docs/SEALOS_DEVBOX_RELEASE_WORKFLOW.md)
- [Development and release policy](./DEPLOY.md)
