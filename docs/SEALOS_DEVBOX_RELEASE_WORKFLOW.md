# Sealos Devbox Development Release Workflow

## Current runtime model

The Sealos development application runs the checked-out source tree in the
Devbox workspace. It is not an immutable Docker image that automatically
rebuilds from GitHub:

```bash
cd ~/project/cart-transform-poc
exec npm run docker-start
```

After pulling a new commit, the process startup builds Remix before Prisma
setup and server start. This prevents a new source revision from serving stale
routes or frontend code.

This workflow applies only to `cart-transform-poc-dev` and must not be used for
the Custom Distribution App `cart-transform-poc`.

## Pull

Run these commands in the Devbox repository. Use the exact approved commit
hash when one was provided:

```bash
cd ~/project/cart-transform-poc
git fetch origin
git merge --ff-only origin/main
git rev-parse --short HEAD
```

If `git merge --ff-only origin/main` reports that the branch is not a
single-branch fast-forward, inspect the branch configuration and use:

```bash
git pull --ff-only origin main
```

Do not run both commands after one has already completed successfully.

## Start or restart the app

The normal process command is:

```bash
npm run docker-start
```

It runs `npm run build`, `npm run setup`, and then `npm run start`. `setup` runs
Prisma client generation and migrations. Keep the Sealos start command as
`cd ~/project/cart-transform-poc && exec npm run docker-start`; do not put
`git pull` into the start command.

## Post-release checks

1. Confirm the Devbox `HEAD` matches the approved commit.
2. Confirm the Pod log shows the Remix build completed successfully before the
   server starts.
3. Confirm the Sealos Pod is Ready and the app-server logs show the current
   start time.
4. Confirm `https://<Sealos-app-domain>/healthz` returns
   `{"ok":true,"service":"cart-transform-poc"}`. This endpoint is a
   no-store process readiness probe only; it does not authenticate or access
   Shopify data.
5. Open the embedded `cart-transform-poc-dev` app in Shopify Admin.
6. Verify Bundle Admin routes, then run the approved UI regression checks.
7. If the batch changes the Function or Theme App Extension, use the separate
   approved Shopify deployment workflow and run Browser -> Cart -> Checkout
   regression checks.

Updating the Devbox app-server source does not deploy a Shopify Function or a
Theme App Extension.

## Development persistence reconciliation

Before any separately approved development-store publication or rollback
verification, run this read-only command locally:

```bash
npm run reconcile:shopify-persistence:dev
```

It is pinned to `cart-transform-poc-dev`, `huang-mvqquz1p.myshopify.com`, and
Admin API `2026-04`. It reads only the fixed Phase 4.4D Metaobject handles and
the `aces_dev` Snapshot/pointer metafields. The command rejects GraphQL
mutations by construction and never creates, updates, or deletes Shopify data.

The fixed Phase 4.4D handles are an adapter-validation fixture, not a
publication baseline. A reconciliation that reports `pointer_drift.detected`
must not be used as input to publication or rollback. Create and validate a
separate approved BundleDefinition/Revision lifecycle before any guarded
publication exercise.

Before any future approved write, generate the local-only isolated rehearsal
plan from two validated Bundle Config V1 files:

```bash
npm run plan:shopify-publication-rehearsal:dev -- --baseline <baseline.json> --candidate <candidate.json>
```

The planner neither calls Shopify CLI nor has an apply mode. It rejects the
current `aces_dev.bundle_runtime_snapshot_v1`,
`aces_dev.active_revision_id_v1`, and `aces_dev.bundle_runtime_snapshot_test`
keys. Any future dev rehearsal must use the generated
`publication_rehearsal` carriers and receive a separate write approval.

## Security and boundaries

- Never print or commit Shopify secrets or Sealos environment values.
- Never commit `shopify.app.local.toml` or temporary probe files.
- Do not touch production resources, products, inventory, theme, or the Custom
  Distribution App.
- Do not recreate Cart Transform registration as part of an app-server release.
- Do not run seed scripts unless a separate task explicitly authorizes them.
