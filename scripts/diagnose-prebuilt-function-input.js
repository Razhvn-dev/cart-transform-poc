import { extractPrebuiltBundleRuntimeFunctionInput } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-runtime.function-input.js";
import { buildPrebuiltBundleRuntimeLocalCandidate } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-runtime.local-candidate.js";
import { PREBUILT_BUNDLE_RUNTIME_CATALOG_SCHEMA_VERSION } from "../extensions/master-kit-expand/src/config/prebuilt-bundle-runtime.catalog-lookup.js";

export function diagnosePrebuiltFunctionInput(input) {
  const normalized = extractPrebuiltBundleRuntimeFunctionInput(input);
  const candidate = buildPrebuiltBundleRuntimeLocalCandidate({
    cart_lines: input?.cart?.lines,
    catalog: {
      schema_version: PREBUILT_BUNDLE_RUNTIME_CATALOG_SCHEMA_VERSION,
      status: "ready",
      entries: normalized.entries,
      unavailable: [],
    },
    snapshots_by_definition_id: normalized.snapshots_by_definition_id,
  });
  const operations = candidate?.result?.operations ?? [];

  return Object.freeze({
    status: candidate?.status ?? "invalid",
    input_observations: sanitizeObservations(normalized.observations),
    metadata_observations: (candidate?.metadata_observations ?? []).map((item) => ({
      cart_line_id: item?.cart_line_id ?? null,
      status: item?.observation?.status ?? "invalid",
      reason: item?.observation?.reason ?? null,
    })),
    prepared_candidate_count: candidate?.prepared_candidate_count ?? 0,
    operation_count: operations.length,
    operation_shape_issues: candidate?.operation_shape_issues ?? [],
    operations: operations.map((operation) => ({
      cart_line_id: operation?.expand?.cartLineId ?? null,
      component_count: operation?.expand?.expandedCartItems?.length ?? 0,
      component_variant_gids: (operation?.expand?.expandedCartItems ?? []).map(
        (item) => item?.merchandiseId ?? null,
      ),
      allocated_total: sumAllocatedTotal(operation?.expand?.expandedCartItems),
    })),
  });
}

function sanitizeObservations(observations = []) {
  return observations.map((observation) => ({
    cart_line_id: observation?.cart_line_id ?? null,
    status: observation?.status ?? "rejected",
    reason: observation?.reason ?? null,
  }));
}

function sumAllocatedTotal(items = []) {
  const cents = items.reduce((total, item) => {
    const amount = item?.price?.adjustment?.fixedPricePerUnit?.amount;
    return total + decimalToCents(amount);
  }, 0);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function decimalToCents(value) {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) return 0;
  const [whole, fraction] = value.split(".");
  return Number(whole) * 100 + Number(fraction);
}
