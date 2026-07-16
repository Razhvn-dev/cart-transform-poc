# Sealos Devbox Development Release Workflow

## Current runtime model

The Sealos development application runs the checked-out source tree in the
Devbox workspace. It is not an immutable Docker image that automatically
rebuilds from GitHub:

```bash
cd ~/project/cart-transform-poc
exec npm run docker-start
```

After pulling a new commit, Remix output must be rebuilt. Restarting the old
process alone does not run `npm run build` and therefore cannot add new routes
or frontend code.

This workflow applies only to `cart-transform-poc-dev` and must not be used for
the Custom Distribution App `cart-transform-poc`.

## Pull and build

Run these commands in the Devbox repository. Use the exact approved commit
hash when one was provided:

```bash
cd ~/project/cart-transform-poc
git fetch origin
git merge --ff-only origin/main
git rev-parse --short HEAD
npm run build
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

It runs `npm run setup` and then `npm run start`. `setup` runs Prisma client
generation and migrations; it does not rebuild Remix. Run `npm run build` first
after every source update.

If the Sealos application start command is configurable, the development-only
convenience form is:

```bash
cd ~/project/cart-transform-poc && npm run build && exec npm run docker-start
```

This adds build time to every restart but prevents the app from serving stale
Remix output. Do not put `git pull` into the start command.

## Post-release checks

1. Confirm the Devbox `HEAD` matches the approved commit.
2. Confirm `npm run build` completed successfully.
3. Confirm the Sealos Pod is Ready and the app-server logs show the current
   start time.
4. Open the embedded `cart-transform-poc-dev` app in Shopify Admin.
5. Verify Bundle Admin routes, then run the approved UI regression checks.
6. If the batch changes the Function or Theme App Extension, use the separate
   approved Shopify deployment workflow and run Browser -> Cart -> Checkout
   regression checks.

Updating the Devbox app-server source does not deploy a Shopify Function or a
Theme App Extension.

## Security and boundaries

- Never print or commit Shopify secrets or Sealos environment values.
- Never commit `shopify.app.local.toml` or temporary probe files.
- Do not touch production resources, products, inventory, theme, or the Custom
  Distribution App.
- Do not recreate Cart Transform registration as part of an app-server release.
- Do not run seed scripts unless a separate task explicitly authorizes them.
