import { describe, expect, it } from "vitest";

import { compileRuntimeSnapshot } from "./bundle-runtime.compiler.js";
import { masterKitConfigV1 } from "./fixtures/master-kit-config.v1.js";
import { buildPriceEvidencedDraftRevision } from "./prebuilt-bundle-price-evidenced-revision.js";

const REVISION_1 = "77770000-0000-4000-8000-000000000001";
const REVISION_2 = "77770000-0000-4000-8000-000000000002";

function publishedRevision() {
  const configuration = structuredClone(masterKitConfigV1);
  configuration.component_groups = configuration.component_groups.slice(0, 2).map((group) => ({
    ...group,
    options: group.options.slice(0, 1),
    default_option_key: group.options[0].option_key,
  }));
  configuration.compatibility_rules = [];
  configuration.presets = [];
  const snapshot = compileRuntimeSnapshot(configuration);
  return {
    schema_version: "bundle_revision.v1",
    revision_id: REVISION_1,
    bundle_definition_id: configuration.configuration_id,
    revision_number: 1,
    status: "published",
    configuration,
    runtime_snapshot_ref: {
      schema_version: snapshot.snapshot_schema,
      checksum_algorithm: snapshot.checksum_algorithm,
      checksum: snapshot.checksum,
      configuration_version: 1,
    },
    created_at: "2026-07-21T00:00:00Z",
    updated_at: "2026-07-21T00:00:00Z",
    created_by: "test",
  };
}

describe("pre-built price-evidenced immutable revision", () => {
  it("allocates the parent price proportionally and records immutable evidence", () => {
    const published = publishedRevision();
    const options = published.configuration.component_groups.flatMap((group) => group.options);
    const result = buildPriceEvidencedDraftRevision({
      publishedRevision: published,
      revisionId: REVISION_2,
      createdAt: "2026-07-21T08:00:00Z",
      createdBy: "huang-mvqquz1p.myshopify.com",
      storeDomain: "huang-mvqquz1p.myshopify.com",
      parent: {
        variant_gid: published.configuration.parent.variant_gid,
        sku: published.configuration.parent.sku,
        variant_price_cents: 55999,
      },
      components: options.map((option, index) => ({
        variant_gid: option.variant_gid,
        sku: option.sku,
        variant_price_cents: index === 0 ? 46999 : 11999,
      })),
    });

    expect(result).toMatchObject({ revision_id: REVISION_2, revision_number: 2, status: "draft" });
    expect(result.configuration.component_groups.flatMap((group) => group.options)
      .map((option) => option.price_cents_snapshot)).toEqual([44610, 11389]);
    expect(result.configuration.pricing.price_evidence).toMatchObject({
      schema_version: "prebuilt_bundle_price_evidence.v1",
      component_subtotal_cents: 58998,
      bundle_price_cents: 55999,
      discount_cents: 2999,
      allocation_total_cents: 55999,
    });
    expect(result.configuration.pricing.price_evidence.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(compileRuntimeSnapshot(result.configuration).groups.flatMap((group) => group.options)
      .map((option) => option.price_cents)).toEqual([44610, 11389]);
  });

  it("fails closed for parent drift or incomplete component evidence", () => {
    const published = publishedRevision();
    const option = published.configuration.component_groups[0].options[0];
    const input = {
      publishedRevision: published,
      revisionId: REVISION_2,
      createdAt: "2026-07-21T08:00:00Z",
      createdBy: "test",
      storeDomain: "huang-mvqquz1p.myshopify.com",
      parent: { variant_gid: "gid://shopify/ProductVariant/999", sku: "DRIFT", variant_price_cents: 100 },
      components: [{ variant_gid: option.variant_gid, sku: option.sku, variant_price_cents: 100 }],
    };
    expect(() => buildPriceEvidencedDraftRevision(input)).toThrow("parent Variant");
    expect(() => buildPriceEvidencedDraftRevision({
      ...input,
      parent: {
        variant_gid: published.configuration.parent.variant_gid,
        sku: published.configuration.parent.sku,
        variant_price_cents: 100,
      },
    })).toThrow("every configured component");
  });
});
