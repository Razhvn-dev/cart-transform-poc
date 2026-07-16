import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { bundleAdminRoutes } from "../domains/bundle-admin/bundle-admin.routes.server.js";

export const loader = (args: LoaderFunctionArgs) => bundleAdminRoutes.getBundleDetail(args);
export const action = (args: ActionFunctionArgs) => bundleAdminRoutes.updateBundleDefinition(args);
