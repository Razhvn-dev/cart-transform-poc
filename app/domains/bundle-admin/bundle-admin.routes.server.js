import { authenticate } from "../../shopify.server";
import { createBundleAdminRouteHandlers } from "./bundle-admin.http.server.js";
import { createDevShopifyBundleAdminService } from "./bundle-admin.shopify-service.server.js";

export const bundleAdminRoutes = createBundleAdminRouteHandlers({
  authenticateAdmin: authenticate.admin,
  getService: ({ admin }) => createDevShopifyBundleAdminService({ admin }),
});
