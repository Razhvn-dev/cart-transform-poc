import { describe, expect, it } from "vitest";

import { selectDevCatalogRepresentativeBatch } from "./dev-catalog-representative-batch-selection.js";

function candidate(parentSku, componentCount, { title = parentSku, published = "true", duplicateComponent = false } = {}) {
  return {
    parent_sku: parentSku,
    source_checksum: `${parentSku}-checksum`,
    status: "ready_for_target_binding",
    parent: { product_title: title, product_status: "active", published, price: "100.00" },
    components: Array.from({ length: componentCount }, (_, index) => ({
      sku: duplicateComponent ? "SAME" : `${parentSku}-C${index + 1}`,
      price: "25.00",
      quantity: 1,
      product_status: "active",
      published: "true",
    })),
  };
}

const report = {
  schema_version: "dev_catalog_target_mapping_candidates.v1",
  candidates: [
    candidate("BLANK-3", 3, { title: "" }),
    candidate("READY-3", 3),
    candidate("READY-4", 4),
    candidate("DUPLICATE-4", 4, { duplicateComponent: true }),
  ],
};

describe("development catalogue representative batch selection", () => {
  it("selects deterministic titled representatives for each requested component breadth", () => {
    const first = selectDevCatalogRepresentativeBatch({ catalogReport: report, componentCounts: [3, 4] });
    const second = selectDevCatalogRepresentativeBatch({ catalogReport: report, componentCounts: [3, 4] });

    expect(first).toEqual(second);
    expect(first.complete).toBe(true);
    expect(first.assigns_business_taxonomy).toBe(false);
    expect(first.records.map((record) => record.parent_sku)).toEqual(["READY-3", "READY-4"]);
  });

  it("honors exclusions and fails closed when no eligible representative remains", () => {
    const result = selectDevCatalogRepresentativeBatch({
      catalogReport: report,
      componentCounts: [3, 4],
      excludedParentSkus: ["READY-3", "BLANK-3"],
    });

    expect(result.complete).toBe(false);
    expect(result.records[0]).toMatchObject({ status: "unavailable", parent_sku: null });
    expect(result.records[1]).toMatchObject({ status: "selected", parent_sku: "READY-4" });
  });

  it("allows unknown component product state because live read-back remains mandatory", () => {
    const unknownComponentState = candidate("UNKNOWN-3", 3);
    unknownComponentState.components[0].product_status = "";
    unknownComponentState.components[0].published = "";
    const result = selectDevCatalogRepresentativeBatch({
      catalogReport: { ...report, candidates: [unknownComponentState] },
      componentCounts: [3],
    });

    expect(result.records[0]).toMatchObject({ status: "selected", parent_sku: "UNKNOWN-3" });
  });

  it("rejects invalid report and component-count requests", () => {
    expect(() => selectDevCatalogRepresentativeBatch({ catalogReport: {}, componentCounts: [3] })).toThrow(/catalog report/);
    expect(() => selectDevCatalogRepresentativeBatch({ catalogReport: report, componentCounts: [3, 3] })).toThrow(/component counts/);
  });
});
