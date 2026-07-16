import type { ActionFunctionArgs } from "@remix-run/node";
import { bundleAdminRoutes } from "../domains/bundle-admin/bundle-admin.routes.server.js";

export const action = (args: ActionFunctionArgs) => bundleAdminRoutes.prepareDraftPublication(args);
