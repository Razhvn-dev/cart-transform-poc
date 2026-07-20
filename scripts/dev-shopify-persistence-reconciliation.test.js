import { describe, expect, it } from "vitest";
import {
  DEV_PERSISTENCE_RECONCILIATION_TARGET,
  assertReadOnlyGraphql,
  buildDevPersistenceReconciliationQuery,
  summarizeDevPersistenceReconciliation,
} from "./dev-shopify-persistence-reconciliation.js";

describe("development Shopify persistence reconciliation", () => {
  it("is pinned to the guarded development target and cannot contain writes", () => {
    const query = buildDevPersistenceReconciliationQuery();

    expect(DEV_PERSISTENCE_RECONCILIATION_TARGET).toMatchObject({
      appConfig: "shopify.app.dev.toml",
      store: "huang-mvqquz1p.myshopify.com",
      apiVersion: "2026-04",
    });
    expect(query).toContain("$app:aces_bundle_definition_dev");
    expect(query).toContain("aces_dev");
    expect(() => assertReadOnlyGraphql(query)).not.toThrow();
    expect(() => assertReadOnlyGraphql("mutation Unsafe { metafieldsSet(metafields: []) { userErrors { message } } }")).toThrow(/query/);
  });

  it("returns only reconciliation identifiers and checksum/pointer state", () => {
    expect(summarizeDevPersistenceReconciliation({
      data: {
        shop: { myshopifyDomain: "huang-mvqquz1p.myshopify.com" },
        currentAppInstallation: { id: "gid://shopify/AppInstallation/1", accessScopes: [{ handle: "read_metaobjects" }] },
        definition: {
          id: "gid://shopify/Metaobject/1",
          type: "$app:aces_bundle_definition_dev",
          handle: "definition",
          fields: [{ key: "document", jsonValue: { bundle_definition_id: "definition", active_revision_id: null } }],
        },
        revision: null,
        publication: null,
        product: {
          snapshot: { jsonValue: { snapshot_schema: "bundle_runtime.v1", configuration_version: 1, checksum: "1234abcd" }, compareDigest: "snapshot-digest" },
          activeRevision: { value: "revision-id", compareDigest: "pointer-digest" },
          runtimeTest: null,
        },
      },
    })).toEqual(expect.objectContaining({
      store: "huang-mvqquz1p.myshopify.com",
      scopes: ["read_metaobjects"],
      records: { bundle_definition: expect.objectContaining({ handle: "definition" }), bundle_revision: null, publication_record: null },
      runtime_snapshot: expect.objectContaining({ checksum: "1234abcd", compare_digest: "snapshot-digest" }),
      active_revision: { value: "revision-id", compare_digest: "pointer-digest" },
      pointer_drift: { definition_active_revision_id: null, product_active_revision_id: "revision-id", detected: true },
    }));
  });
});
