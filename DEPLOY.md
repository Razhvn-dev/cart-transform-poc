# Development and Release Workflow

This project uses a two-mode workflow. The root `AGENTS.md` is the mandatory authority for AI agents; this file mirrors the same workflow for human operators.

## What Huang Needs To Say

For local work:

> 按项目工作流继续开发这个功能，完成后只做本地验证和商店预览，不要发布。

For release:

> 这个功能已经确认通过，按项目工作流正式发布。

## Mode A - Local Development

Use this mode for all feature work unless Huang explicitly approves a stable release.

Trigger phrases include:

- 本地开发
- 本地验证
- 先看效果
- 不要发布
- local preview
- local validation

Required behavior:

1. Modify code locally.
2. Run validation:

   ```powershell
   npm run validate:local
   ```

3. Start local Shopify preview only when Huang asks for store preview:

   ```powershell
   npm run dev:local
   ```

4. Open/test the feature in the Shopify development store.
5. Report the preview URL and verification result.
6. Stop and wait for Huang's approval.

Do not commit, push, update DevBox, publish Sealos, run stable Shopify deployment, update Shopify stable URLs, or modify Shopify store data in Mode A.

## Mode B - Stable Release

Use this mode only after Huang explicitly says the feature has passed and is approved for release.

Trigger phrases include:

- 正式发布
- 发布到稳定环境
- 已确认通过
- stable release
- release approved

Required behavior:

1. Confirm the feature already passed Mode A local validation.
2. Run final validation:

   ```powershell
   npm run validate:stable
   ```

3. Commit approved changes with an intentional message.
4. Push to GitHub.
5. Update the DevBox repository from GitHub.
6. Build the project in DevBox.
7. Publish a new DevBox version.
8. Redeploy/update the Sealos Application.
9. Deploy Shopify app configuration/extensions using the stable dev config:

   ```powershell
   npm run deploy:dev
   ```

10. Verify the Shopify Admin app loads from Sealos.
11. Verify Standard and Advanced cart/checkout flows.
12. Report commit, GitHub push, Sealos version, Shopify app version, and smoke-test results.

## Exact NPM Commands

Local preview:

```powershell
npm run dev:local
```

Stable Shopify deployment:

```powershell
npm run deploy:dev
```

Validation:

```powershell
npm run lint
npm run build
npm run test:function
npm run build:function
```

Combined validation:

```powershell
npm run validate:local
npm run validate:stable
```

## Runtime Notes

- Package manager: npm.
- Build command: `npm run build`.
- Production start command: `npm run docker-start`.
- Remix server command: `remix-serve ./build/server/index.js`.
- Container port: `3000`.
- Keep Shopify Functions and Theme App Extension deployment separate from the web container release process unless Mode B is explicitly approved.

`npm run docker-start` runs:

```powershell
npm run setup && npm run start
```

`npm run setup` runs Prisma generation and migrations:

```powershell
prisma generate && prisma migrate deploy
```

## Sealos Environment Variables

Do not change Sealos environment variables during Mode A.

Required values for the Sealos Application are managed outside this document:

```text
NODE_ENV=production
PORT=3000
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_APP_URL=https://your-public-sealos-domain.example.com
SCOPES=write_products,write_cart_transforms,read_cart_transforms
```

Optional:

```text
SHOP_CUSTOM_DOMAIN=your-shop-custom-domain.example.com
```

## Database Note

The current Prisma schema uses SQLite:

```prisma
url = "file:dev.sqlite"
```

Without persistent storage, sessions can be lost when the container restarts.

Do not mount an empty volume over `/app/prisma`, because that directory also contains `schema.prisma` and migrations required by `prisma migrate deploy`.

Before a long-lived production deployment, choose one persistence strategy:

- bind-mount only the SQLite database file at `/app/prisma/dev.sqlite`, or
- migrate Prisma to an environment-driven `DATABASE_URL` and use a managed database.
