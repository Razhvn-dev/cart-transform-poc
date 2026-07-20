import { createPrebuiltBundleRuntimeAssignments } from "./prebuilt-bundle-runtime.assignment.js";
import { buildPrebuiltBundleRuntimeCatalog } from "./prebuilt-bundle-runtime.catalog.js";

/**
 * Local audit boundary for the complete pre-built SKU preparation chain.
 * It has no persistence or Function dependency and never treats readiness as
 * publication authorization.
 */
export function assessPrebuiltBundleRuntimeReadiness({
  import_plan,
  pilot_scope,
  definitions,
  revisions,
  snapshots_by_definition_id,
} = {}) {
  const assignmentResult = createPrebuiltBundleRuntimeAssignments({ import_plan, pilot_scope });
  if (assignmentResult.status !== "ready") {
    return deepFreeze({
      status: "invalid",
      assignments: assignmentResult,
      catalog: null,
      cart_metadata: localOnlyCartMetadata(),
      function_integration: blockedFunctionIntegration(),
      summary: { assignments_ready: 0, mappings_ready: 0, unavailable: 0 },
    });
  }
  const catalog = buildPrebuiltBundleRuntimeCatalog({
    definitions,
    revisions,
    snapshots_by_definition_id,
    assignments: assignmentResult.assignments,
    pilot_scope,
  });
  const mappingsReady = catalog.entries?.length ?? 0;
  const unavailable = (assignmentResult.unavailable?.length ?? 0) + (catalog.unavailable?.length ?? 0);
  return deepFreeze({
    status: catalog.status === "ready" && mappingsReady > 0 ? "ready" : "not_ready",
    assignments: assignmentResult,
    catalog,
    cart_metadata: localOnlyCartMetadata(),
    // A valid mapping catalog and local Metadata V1 contract alone cannot make
    // pre-built expansion live. The normal-product Theme block has not yet
    // been verified in a Cart line or approved for Function integration.
    function_integration: blockedFunctionIntegration(),
    summary: {
      assignments_ready: assignmentResult.assignments.length,
      mappings_ready: mappingsReady,
      unavailable,
    },
  });
}

function localOnlyCartMetadata() {
  return {
    status: "local_contract_only",
    source: "prebuilt-bundle-product-form",
    verification_required: [
      "development_store_theme_block_cart_verification",
      "cart_line_bundle_metadata_v1_observation",
    ],
  };
}

function blockedFunctionIntegration() {
  return {
    status: "blocked",
    reason: "PREBUILT_CART_METADATA_NOT_VERIFIED",
    required_before_integration: [
      "development_store_theme_block_cart_verification",
      "cart_line_bundle_metadata_v1_observation",
      "function_query_and_candidate_gate_review",
      "development_store_checkout_order_inventory_validation",
    ],
  };
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
