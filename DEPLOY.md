# Development and Release Workflow

This document is the operator-facing release policy. `AGENTS.md` and the
current Project Master Context remain the engineering authority.

## Mode A: local development

Use Mode A for feature work, local validation, and embedded Admin preview.
The expected instruction is:

> Continue local development and validation only. Do not release.

Run:

```powershell
npm run validate:local
npm run dev:local
```

Mode A does not commit, push, update Devbox, publish Sealos, deploy Shopify app
configuration, or modify Shopify store data. Stop the local preview with
`Ctrl+C` when testing is complete.

## Mode B: approved development release

Use Mode B only after the feature has passed local validation and Huang has
explicitly approved a development release:

> This feature passed validation. Release it to the development environment.

The release sequence is:

1. Run `npm run validate:stable` locally.
2. Commit only the reviewed files and push the approved commit to `origin/main`.
3. In Devbox, pull that exact commit and run `npm run build`.
4. Publish a new Devbox version and update the Sealos application.
5. Verify the embedded Admin app from Sealos.
6. If the batch changes Shopify Functions or the Theme App Extension, deploy
   those extensions separately using the explicitly approved development config:

   ```powershell
   npm run deploy:dev
   ```

7. Run the required browser and Cart -> Checkout regression checks.

App-server release, Shopify Function deployment, and Theme App Extension
deployment are separate operations. Restarting an old process does not rebuild
Remix output.

## Local commands

```powershell
npm test
npm run lint
npm run build
npm run test:function
npm run validate:local
npm run assert:function:production-clean
```

`npm run dev:local` uses `shopify.app.local.toml`, the development store, the
production Function profile, and the Shopify CLI localhost preview. It is a
local Admin preview, not a Shopify deployment.

## Devbox/Sealos runtime

The current Devbox process starts the checked-out source tree:

```bash
cd ~/project/cart-transform-poc
npm run build
exec npm run docker-start
```

`npm run docker-start` runs Prisma setup and then starts the already-built
Remix server; it does not run `npm run build`. The exact pull/build/release
steps are in
[`docs/SEALOS_DEVBOX_RELEASE_WORKFLOW.md`](./docs/SEALOS_DEVBOX_RELEASE_WORKFLOW.md).

## Development environment

Authorized target:

```text
app:    cart-transform-poc-dev
store:  huang-mvqquz1p.myshopify.com
config: shopify.app.dev.toml
```

The development app scopes include:

```text
read_metaobjects
write_metaobjects
read_cart_transforms
write_cart_transforms
write_products
```

Do not change Sealos environment variables during Mode A. Secrets must remain
in the deployment environment and must never be committed or pasted into
issues, chat, screenshots, or logs.

## Persistence warning

The Prisma session database is SQLite (`file:dev.sqlite`). Without a persistent
mount or managed database, sessions can be lost when the container restarts.
Do not mount an empty volume over `/app/prisma`; that directory also contains
the schema and migrations. A future long-lived deployment must choose either a
file mount for the database file or an environment-driven managed database.

## Prohibited without explicit approval

- Custom Distribution App `cart-transform-poc`;
- production Shopify resources or production Function authority;
- Cart Transform registration recreation;
- products, prices, inventory, theme, or storefront data;
- seed scripts and temporary probe mutations;
- `shopify.app.local.toml`, secrets, caches, and build artifacts in Git.
