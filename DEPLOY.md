# Sealos Docker Deployment

This project is a Shopify Remix app prepared for containerized deployment.

## Project Runtime

- Package manager: npm
- Build command: `npm run build`
- Production start command: `npm run docker-start`
- Remix server command: `remix-serve ./build/server/index.js`
- Node runtime: Node 24 Alpine image
- Container port: `3000`

`npm run docker-start` runs:

```sh
npm run setup && npm run start
```

`npm run setup` runs Prisma generation and migrations:

```sh
prisma generate && prisma migrate deploy
```

## Required Environment Variables

Set these in Sealos Application environment variables:

```sh
NODE_ENV=production
PORT=3000
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_APP_URL=https://your-public-sealos-domain.example.com
SCOPES=write_products,write_cart_transforms,read_cart_transforms
```

Optional:

```sh
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

## Build Locally

```sh
docker build -t cart-transform-poc .
```

## Run Locally

```sh
docker run --rm -p 3000:3000 --env-file .env cart-transform-poc
```

## Run With Docker Compose

```sh
docker compose up --build
```

Stop:

```sh
docker compose down
```

## Sealos Deployment Recommendations

1. Create a Sealos Application from this Docker image or repository.
2. Set container port to `3000`.
3. Set all required Shopify environment variables.
4. Add a persistence strategy for Shopify app sessions before long-lived production use.
5. Use HTTPS public ingress for the app domain.
6. Set `SHOPIFY_APP_URL` to the final HTTPS Sealos domain.
7. Keep Shopify Functions and Theme App Extension deployment separate from the web container release process.

## Updating Shopify Application URL

After Sealos provides the final HTTPS domain:

1. Set `SHOPIFY_APP_URL` in Sealos to the final domain.
2. Update `application_url` in the Shopify app configuration for the deployed app.
3. Update OAuth redirect URLs to:

```text
https://your-public-sealos-domain.example.com/auth/callback
```

4. Apply the app configuration through the normal Shopify app deployment process when ready.

Do not point production Shopify app URLs at a temporary local tunnel.

## Production Smoke Check

After the container starts:

```sh
curl https://your-public-sealos-domain.example.com
```

Then open the embedded app from Shopify Admin and complete OAuth installation.
