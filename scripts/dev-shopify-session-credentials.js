export function resolveDevShopifySessionCredentials({ expectedClientId, clientId, clientSecret } = {}) {
  if (typeof expectedClientId !== "string" || expectedClientId.trim() === "") {
    throw new Error("locked development client ID is required");
  }
  if (clientId !== expectedClientId) {
    throw new Error("credentials do not belong to the locked development app");
  }
  const normalizedSecret = typeof clientSecret === "string" && clientSecret.trim() !== ""
    ? clientSecret
    : undefined;
  return { clientId, clientSecret: normalizedSecret };
}
