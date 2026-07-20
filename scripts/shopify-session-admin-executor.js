export function createShopifySessionAdminExecutor({
  prisma,
  shop,
  apiVersion,
  clientId,
  clientSecret,
  fetchImpl = fetch,
  readOnlyAttempts = 4,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof prisma?.session?.findFirst !== "function") throw new Error("Prisma Session storage is required");
  if (typeof shop !== "string" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    throw new Error("a valid myshopify.com development store is required");
  }
  if (typeof apiVersion !== "string" || !/^\d{4}-\d{2}$/.test(apiVersion)) {
    throw new Error("a Shopify Admin API version is required");
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch is required");

  return async function execute(query, { variables = {} } = {}) {
    const session = await prisma.session.findFirst({
      where: { shop, isOnline: false },
      orderBy: { expires: "desc" },
      select: {
        id: true,
        accessToken: true,
        expires: true,
        refreshToken: true,
        refreshTokenExpires: true,
      },
    });
    if (!session?.accessToken) throw new Error("no offline Shopify Admin session is available for the development store");
    let accessToken = session.accessToken;
    if (session.expires && session.expires.getTime() <= Date.now()) {
      accessToken = await refreshOfflineSession({
        prisma,
        session,
        shop,
        clientId,
        clientSecret,
        fetchImpl,
        wait,
      });
    }
    const readOnly = /^\s*(?:#graphql\s*)?query\b/i.test(query) && !/\bmutation\b/i.test(query);
    const attempts = readOnly ? readOnlyAttempts : 1;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetchImpl(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-shopify-access-token": accessToken,
          },
          body: JSON.stringify({ query, variables }),
        });
        const payload = await response.json();
        if (!response.ok || payload?.errors?.length || !payload?.data) {
          throw new ShopifySessionAdminResponseError(
            `Shopify Admin GraphQL request failed: ${response.status} ${summarizeErrors(payload)}`,
          );
        }
        return payload;
      } catch (error) {
        lastError = error;
        if (error instanceof ShopifySessionAdminResponseError || !readOnly || attempt === attempts) throw error;
        await wait(250 * attempt);
      }
    }
    throw lastError;
  };
}

class ShopifySessionAdminResponseError extends Error {}

async function refreshOfflineSession({ prisma, session, shop, clientId, clientSecret, fetchImpl, wait }) {
  if (typeof clientId !== "string" || clientId === ""
    || typeof clientSecret !== "string" || clientSecret === ""
    || typeof session.refreshToken !== "string" || session.refreshToken === "") {
    throw new Error("the expired offline Shopify Admin session cannot be refreshed safely");
  }
  if (session.refreshTokenExpires && session.refreshTokenExpires.getTime() <= Date.now()) {
    throw new Error("the offline Shopify Admin refresh token has expired");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
  });
  let payload;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: body.toString(),
      });
      payload = await response.json();
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          await wait(500 * attempt);
          continue;
        }
        throw new ShopifySessionAdminResponseError(`Shopify offline token refresh failed: ${response.status}`);
      }
      break;
    } catch (error) {
      if (error instanceof ShopifySessionAdminResponseError || attempt === 3) throw error;
      await wait(500 * attempt);
    }
  }
  if (typeof payload?.access_token !== "string" || typeof payload?.refresh_token !== "string") {
    throw new Error("Shopify offline token refresh returned no rotated tokens");
  }
  const now = Date.now();
  await prisma.session.update({
    where: { id: session.id },
    data: {
      accessToken: payload.access_token,
      expires: new Date(now + Number(payload.expires_in) * 1000),
      refreshToken: payload.refresh_token,
      refreshTokenExpires: new Date(now + Number(payload.refresh_token_expires_in) * 1000),
      ...(typeof payload.scope === "string" ? { scope: payload.scope } : {}),
    },
  });
  return payload.access_token;
}

function summarizeErrors(payload) {
  if (!Array.isArray(payload?.errors)) return "no GraphQL data";
  return payload.errors.map((error) => error.message).filter(Boolean).join("; ");
}
