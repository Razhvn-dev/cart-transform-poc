import { json, type LoaderFunctionArgs } from "@remix-run/node";

// Container-level readiness probe. It deliberately avoids Shopify auth and data access.
export const loader = async (_args: LoaderFunctionArgs) => json(
  { ok: true, service: "cart-transform-poc" },
  { headers: { "Cache-Control": "no-store" } },
);
