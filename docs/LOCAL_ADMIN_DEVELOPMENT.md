# Bundle Admin Local Development

## Purpose

Use this workflow for Bundle Admin UI and app-server work before a Sealos release.
It keeps the Cart Transform on the production hard-coded Shared Core and does
not deploy an app version, Theme App Extension, or Shopify Function.

## Embedded Shopify Admin Preview

From the repository root, run:

```powershell
npm run dev:local
```

This starts the local Remix server through the project-pinned Shopify CLI with:

- `shopify.app.local.toml`
- development app `cart-transform-poc-dev`
- development store `huang-mvqquz1p.myshopify.com`
- `FUNCTION_PROFILE=production`
- `--use-localhost`
- `--no-update`
- `https://localhost:3001`

Open the preview URL printed by Shopify CLI in the same browser that is logged
in to the development store. Stop the command with `Ctrl+C` when finished.

`--no-update` uses the localhost URL from the local TOML and prevents the CLI
from updating the remote app configuration. `--use-localhost` makes the
browser load the app securely from `https://localhost:3001` on this computer.
Shopify Admin blocks embedded HTTP pages; the CLI proxy provides the local
certificate. The preview does not create a Sealos image or run
`shopify app deploy`. The local configuration deliberately declares no
webhook subscriptions because Shopify cannot invoke `localhost` webhooks.
This preview must not be used to test Cart Transform authority changes.

## Web-Only Server

For Remix startup, route compilation, or non-embedded diagnostics only, run:

```powershell
npm run dev:web
```

Then open `http://localhost:3001`. This command does not invoke Shopify CLI or
contact Shopify. Embedded authenticated routes require the Shopify CLI preview
command above because they need a real Admin session.

## Release Boundary

Use Sealos only after a coherent batch has passed local tests and the embedded
local preview. A Sealos release is still required for a stable public app URL
and final development-store verification, but it is not required for each UI
edit.

For the current Devbox-backed Sealos release procedure, see
[`SEALOS_DEVBOX_RELEASE_WORKFLOW.md`](./SEALOS_DEVBOX_RELEASE_WORKFLOW.md).
