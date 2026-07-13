FROM node:24-alpine AS base

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache openssl

FROM base AS deps

ENV NODE_ENV=development

COPY package.json package-lock.json ./
COPY extensions/master-kit-expand/package.json ./extensions/master-kit-expand/package.json

RUN npm ci

FROM deps AS build

COPY . .

RUN npm run build

FROM base AS runtime

COPY package.json package-lock.json ./
COPY extensions/master-kit-expand/package.json ./extensions/master-kit-expand/package.json

RUN npm ci --omit=dev \
  && npm remove @shopify/cli \
  && npm cache clean --force

COPY --from=build /app/build ./build
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
