import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildPrebuiltSupplierPresentation } from "./prebuilt-supplier-presentation.js";

const componentA = "gid://shopify/ProductVariant/201";
const componentB = "gid://shopify/ProductVariant/202";
const inputSchema = JSON.parse(readFileSync(
  new URL("../docs/schemas/prebuilt-supplier-presentation.v1.schema.json", import.meta.url),
  "utf8",
));

function fulfillmentIdentity(overrides = {}) {
  return {
    supplier_id: "supplier-alpha",
    location_id: "location-alpha",
    ...overrides,
  };
}

function componentLine({
  lineId,
  bundleInstanceId,
  variantGid = componentA,
  sku = "COMPONENT-A",
  quantity = 1,
  fulfillment = fulfillmentIdentity(),
}) {
  return {
    line_id: lineId,
    variant_gid: variantGid,
    sku,
    quantity,
    bundle_instance_id: bundleInstanceId,
    fulfillment_identity: fulfillment,
  };
}

function mapping({
  bundleInstanceId,
  mainKitSku = "KIT-MAIN",
  fulfillment = fulfillmentIdentity(),
  traceId,
}) {
  return {
    bundle_instance_id: bundleInstanceId,
    main_kit_sku: mainKitSku,
    fulfillment_identity: fulfillment,
    mapping_trace_id: traceId,
  };
}

function input(overrides = {}) {
  return {
    schema_version: "prebuilt_supplier_presentation.v1",
    order: {
      order_id: "gid://shopify/Order/100",
      component_lines: [
        componentLine({
          lineId: "gid://shopify/LineItem/1001",
          bundleInstanceId: "bundle-instance-1",
        }),
        componentLine({
          lineId: "gid://shopify/LineItem/1002",
          bundleInstanceId: "bundle-instance-1",
          variantGid: componentB,
          sku: "COMPONENT-B",
          quantity: 2,
        }),
      ],
    },
    mappings: [
      mapping({
        bundleInstanceId: "bundle-instance-1",
        traceId: "mapping-trace-1",
      }),
    ],
    ...overrides,
  };
}

function schemaAcceptsString(schema, value) {
  return typeof value === "string"
    && (schema.minLength === undefined || value.length >= schema.minLength)
    && (schema.pattern === undefined || new RegExp(schema.pattern).test(value));
}

describe("pre-built supplier presentation", () => {
  it("maps one internal component Order bundle instance to one supplier-facing main Kit SKU", () => {
    const result = buildPrebuiltSupplierPresentation(input());

    expect(result).toMatchObject({
      schema_version: "prebuilt_supplier_presentation.v1",
      status: "ready",
      parent_inventory_authority: false,
      writes_performed: false,
      supplier_lines: [{
        main_kit_sku: "KIT-MAIN",
        quantity: 1,
        fulfillment_identity: fulfillmentIdentity(),
      }],
      reconciliation_trace: [{
        supplier_line_index: 0,
        order_id: "gid://shopify/Order/100",
        bundle_instance_ids: ["bundle-instance-1"],
        component_line_ids: [
          "gid://shopify/LineItem/1001",
          "gid://shopify/LineItem/1002",
        ],
        mapping_trace_ids: ["mapping-trace-1"],
      }],
      issues: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("does not replace, mutate, or derive supplier quantity from internal component quantities", () => {
    const source = input();
    const before = structuredClone(source);

    const result = buildPrebuiltSupplierPresentation(source);

    expect(source).toEqual(before);
    expect(result.supplier_lines).toEqual([{
      main_kit_sku: "KIT-MAIN",
      quantity: 1,
      fulfillment_identity: fulfillmentIdentity(),
    }]);
    expect(result).not.toHaveProperty("component_lines");
    expect(result.parent_inventory_authority).toBe(false);
  });

  it("aggregates bundle-instance count only for the same main SKU and fulfillment identity", () => {
    const source = input({
      order: {
        order_id: "gid://shopify/Order/100",
        component_lines: [
          componentLine({
            lineId: "gid://shopify/LineItem/1001",
            bundleInstanceId: "bundle-instance-1",
          }),
          componentLine({
            lineId: "gid://shopify/LineItem/1002",
            bundleInstanceId: "bundle-instance-2",
            variantGid: componentB,
            sku: "COMPONENT-B",
            quantity: 8,
          }),
        ],
      },
      mappings: [
        mapping({
          bundleInstanceId: "bundle-instance-1",
          traceId: "mapping-trace-1",
        }),
        mapping({
          bundleInstanceId: "bundle-instance-2",
          traceId: "mapping-trace-2",
        }),
      ],
    });

    const result = buildPrebuiltSupplierPresentation(source);

    expect(result.supplier_lines).toEqual([{
      main_kit_sku: "KIT-MAIN",
      quantity: 2,
      fulfillment_identity: fulfillmentIdentity(),
    }]);
    expect(result.reconciliation_trace[0]).toMatchObject({
      bundle_instance_ids: ["bundle-instance-1", "bundle-instance-2"],
      component_line_ids: [
        "gid://shopify/LineItem/1001",
        "gid://shopify/LineItem/1002",
      ],
      mapping_trace_ids: ["mapping-trace-1", "mapping-trace-2"],
    });
  });

  it("keeps the same main SKU separate across unambiguous fulfillment identities", () => {
    const secondFulfillment = fulfillmentIdentity({
      supplier_id: "supplier-beta",
      location_id: "location-beta",
    });
    const source = input({
      order: {
        order_id: "gid://shopify/Order/100",
        component_lines: [
          componentLine({
            lineId: "gid://shopify/LineItem/1001",
            bundleInstanceId: "bundle-instance-1",
          }),
          componentLine({
            lineId: "gid://shopify/LineItem/1002",
            bundleInstanceId: "bundle-instance-2",
            fulfillment: secondFulfillment,
          }),
        ],
      },
      mappings: [
        mapping({
          bundleInstanceId: "bundle-instance-1",
          traceId: "mapping-trace-1",
        }),
        mapping({
          bundleInstanceId: "bundle-instance-2",
          fulfillment: secondFulfillment,
          traceId: "mapping-trace-2",
        }),
      ],
    });

    const result = buildPrebuiltSupplierPresentation(source);

    expect(result.status).toBe("ready");
    expect(result.supplier_lines).toEqual([
      {
        main_kit_sku: "KIT-MAIN",
        quantity: 1,
        fulfillment_identity: fulfillmentIdentity(),
      },
      {
        main_kit_sku: "KIT-MAIN",
        quantity: 1,
        fulfillment_identity: secondFulfillment,
      },
    ]);
  });

  it("marks a missing bundle-instance mapping as needs_review", () => {
    const result = buildPrebuiltSupplierPresentation(input({ mappings: [] }));

    expect(result).toMatchObject({
      status: "needs_review",
      supplier_lines: [],
      parent_inventory_authority: false,
    });
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "MISSING_MAIN_KIT_MAPPING",
      path: "mappings",
      bundle_instance_id: "bundle-instance-1",
      kind: "needs_review",
    }));
  });

  it.each([
    ["missing", (source) => delete source.mappings[0].main_kit_sku],
    ["empty", (source) => { source.mappings[0].main_kit_sku = ""; }],
    ["whitespace-only", (source) => { source.mappings[0].main_kit_sku = " \t"; }],
  ])("returns invalid when main_kit_sku is %s", (_label, mutate) => {
    const source = input();
    mutate(source);

    const result = buildPrebuiltSupplierPresentation(source);

    expect(result).toMatchObject({
      status: "invalid",
      supplier_lines: [],
      reconciliation_trace: [],
    });
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "INVALID_MAIN_KIT_SKU",
      path: "mappings[0].main_kit_sku",
      kind: "invalid",
    }));
  });

  it("marks conflicting main SKU or fulfillment mappings as needs_review", () => {
    const source = input();
    source.mappings.push(mapping({
      bundleInstanceId: "bundle-instance-1",
      mainKitSku: "KIT-CONFLICT",
      fulfillment: fulfillmentIdentity({ location_id: "location-conflict" }),
      traceId: "mapping-trace-conflict",
    }));

    const result = buildPrebuiltSupplierPresentation(source);

    expect(result.status).toBe("needs_review");
    expect(result.supplier_lines).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "CONFLICTING_BUNDLE_MAPPING",
      bundle_instance_id: "bundle-instance-1",
      kind: "needs_review",
    }));
  });

  it("marks a bundle instance spanning suppliers as needs_review", () => {
    const source = input();
    source.order.component_lines[1].fulfillment_identity = fulfillmentIdentity({
      supplier_id: "supplier-beta",
      location_id: "location-beta",
    });

    const result = buildPrebuiltSupplierPresentation(source);

    expect(result.status).toBe("needs_review");
    expect(result.supplier_lines).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "CROSS_SUPPLIER_BUNDLE_INSTANCE",
      path: "order.component_lines",
      bundle_instance_id: "bundle-instance-1",
      kind: "needs_review",
    }));
  });

  it("marks a mapping assigned to a different supplier as needs_review", () => {
    const source = input();
    source.mappings[0].fulfillment_identity = fulfillmentIdentity({
      supplier_id: "supplier-beta",
      location_id: "location-beta",
    });

    const result = buildPrebuiltSupplierPresentation(source);

    expect(result.status).toBe("needs_review");
    expect(result.supplier_lines).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "CROSS_SUPPLIER_BUNDLE_INSTANCE",
      bundle_instance_id: "bundle-instance-1",
      kind: "needs_review",
    }));
  });

  it("marks a component-to-mapping fulfillment conflict as needs_review", () => {
    const source = input();
    source.mappings[0].fulfillment_identity = fulfillmentIdentity({
      location_id: "location-other",
    });

    const result = buildPrebuiltSupplierPresentation(source);

    expect(result.status).toBe("needs_review");
    expect(result.supplier_lines).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "FULFILLMENT_IDENTITY_CONFLICT",
      bundle_instance_id: "bundle-instance-1",
      kind: "needs_review",
    }));
  });

  it("returns invalid for structurally unsafe component Order input", () => {
    const source = input();
    source.order.component_lines[0].quantity = 0;

    const result = buildPrebuiltSupplierPresentation(source);

    expect(result).toMatchObject({
      status: "invalid",
      supplier_lines: [],
      reconciliation_trace: [],
      parent_inventory_authority: false,
      writes_performed: false,
    });
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "INVALID_COMPONENT_QUANTITY",
      path: "order.component_lines[0].quantity",
      kind: "invalid",
    }));
  });

  it("rejects a document whose contract fields are inherited from a custom prototype", () => {
    const inheritedDocument = Object.create(input());

    const result = buildPrebuiltSupplierPresentation(inheritedDocument);

    expect(result).toMatchObject({
      status: "invalid",
      supplier_lines: [],
      reconciliation_trace: [],
    });
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "INVALID_DOCUMENT",
      path: "document",
      kind: "invalid",
    }));
  });

  it("rejects class instances at nested contract object boundaries", () => {
    class SupplierMapping {
      constructor(value) {
        Object.assign(this, value);
      }
    }

    const source = input();
    source.mappings[0] = new SupplierMapping(source.mappings[0]);

    const result = buildPrebuiltSupplierPresentation(source);

    expect(result).toMatchObject({
      status: "invalid",
      supplier_lines: [],
      reconciliation_trace: [],
    });
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "INVALID_MAPPING",
      path: "mappings[0]",
      kind: "invalid",
    }));
  });

  it("keeps Schema and runtime aligned on rejecting whitespace-only contract strings", () => {
    const definitions = inputSchema.$defs;
    const cases = [
      {
        schema: definitions.internalComponentOrder.properties.order_id,
        mutate: (source) => { source.order.order_id = " \t"; },
        code: "INVALID_ORDER_ID",
      },
      {
        schema: definitions.componentLine.properties.line_id,
        mutate: (source) => { source.order.component_lines[0].line_id = " \t"; },
        code: "INVALID_COMPONENT_LINE_ID",
      },
      {
        schema: definitions.componentLine.properties.sku,
        mutate: (source) => { source.order.component_lines[0].sku = " \t"; },
        code: "INVALID_COMPONENT_SKU",
      },
      {
        schema: definitions.componentLine.properties.bundle_instance_id,
        mutate: (source) => { source.order.component_lines[0].bundle_instance_id = " \t"; },
        code: "INVALID_BUNDLE_INSTANCE_ID",
      },
      {
        schema: definitions.bundleMapping.properties.bundle_instance_id,
        mutate: (source) => { source.mappings[0].bundle_instance_id = " \t"; },
        code: "INVALID_BUNDLE_INSTANCE_ID",
      },
      {
        schema: definitions.bundleMapping.properties.main_kit_sku,
        mutate: (source) => { source.mappings[0].main_kit_sku = " \t"; },
        code: "INVALID_MAIN_KIT_SKU",
      },
      {
        schema: definitions.bundleMapping.properties.mapping_trace_id,
        mutate: (source) => { source.mappings[0].mapping_trace_id = " \t"; },
        code: "INVALID_MAPPING_TRACE_ID",
      },
      {
        schema: definitions.fulfillmentIdentity.properties.supplier_id,
        mutate: (source) => {
          source.order.component_lines[0].fulfillment_identity.supplier_id = " \t";
        },
        code: "INVALID_FULFILLMENT_IDENTITY",
      },
      {
        schema: definitions.fulfillmentIdentity.properties.location_id,
        mutate: (source) => {
          source.mappings[0].fulfillment_identity.location_id = " \t";
        },
        code: "INVALID_FULFILLMENT_IDENTITY",
      },
    ];

    for (const contractCase of cases) {
      expect(schemaAcceptsString(contractCase.schema, " \t")).toBe(false);
      expect(schemaAcceptsString(contractCase.schema, "value")).toBe(true);

      const source = input();
      contractCase.mutate(source);
      const result = buildPrebuiltSupplierPresentation(source);

      expect(result.status).toBe("invalid");
      expect(result.issues.map((item) => item.code)).toContain(contractCase.code);
    }
  });
});
