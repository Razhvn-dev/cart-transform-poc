import type { LoaderFunctionArgs } from "@remix-run/node";
import { bundleAdminRoutes } from "../domains/bundle-admin/bundle-admin.routes.server.js";

export const loader = (args: LoaderFunctionArgs) => bundleAdminRoutes.listRevisionHistory(args);
