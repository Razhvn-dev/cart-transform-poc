import { useEffect, useState } from "react";
import { useFetcher, useNavigate } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Page,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { formatTimestamp, getEnvelopeError, type BundleAdminEnvelope } from "../domains/bundle-admin/bundle-admin.ui-state";

type BundleSummary = {
  bundle_definition_id: string;
  slug: string;
  parent_binding: { product_gid: string; variant_gid: string };
  active_revision_number: number | null;
  draft_revision_number: number | null;
  revision_count: number;
  updated_at: string;
};

type BundleDetail = {
  definition: { bundle_definition_id: string };
};

export default function BundleAdminListPage() {
  const fetcher = useFetcher<BundleAdminEnvelope<BundleSummary[]>>();
  const createFetcher = useFetcher<BundleAdminEnvelope<BundleDetail>>();
  const navigate = useNavigate();
  const [slug, setSlug] = useState("");
  const [productGid, setProductGid] = useState("");
  const [variantGid, setVariantGid] = useState("");
  const loading = fetcher.state !== "idle" && !fetcher.data;
  const creating = createFetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data && fetcher.state === "idle") fetcher.load("/app/bundle-admin/bundles");
  }, [fetcher]);

  useEffect(() => {
    const bundleDefinitionId = createFetcher.data?.ok
      ? createFetcher.data.data.definition.bundle_definition_id
      : null;
    if (bundleDefinitionId) navigate(`/app/bundle-admin/${bundleDefinitionId}`);
  }, [createFetcher.data, navigate]);

  function createBundle() {
    if (!slug.trim() || !productGid.trim() || !variantGid.trim()) return;
    createFetcher.submit(JSON.stringify({
      slug: slug.trim(),
      parent_binding: { product_gid: productGid.trim(), variant_gid: variantGid.trim() },
    }), {
      method: "post",
      action: "/app/bundle-admin/bundles",
      encType: "application/json",
    });
  }

  const error = getEnvelopeError(fetcher.data);
  const createError = getEnvelopeError(createFetcher.data);
  const bundles = fetcher.data?.ok ? fetcher.data.data : [];

  return (
    <Page
      title="Bundle configurations"
      secondaryActions={[
        { content: "Review pre-built import", url: "/app/bundle-admin/prebuilt-imports" },
        { content: "Refresh", onAction: () => fetcher.load("/app/bundle-admin/bundles") },
      ]}
    >
      <TitleBar title="Bundle configurations" />
      <BlockStack gap="400">
        {error ? <InlineError title={error.code} message={error.message} /> : null}
        {createError ? <InlineError title={createError.code} message={createError.message} /> : null}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Create development Bundle</Text>
            <Text as="p" tone="subdued">
              Creates only a development BundleDefinition. It does not publish a Runtime Snapshot, change Cart Transform authority, alter products, or change inventory.
            </Text>
            <TextField label="Bundle slug" value={slug} onChange={setSlug} autoComplete="off" />
            <TextField label="Parent product GID" value={productGid} onChange={setProductGid} autoComplete="off" />
            <TextField label="Parent variant GID" value={variantGid} onChange={setVariantGid} autoComplete="off" />
            <InlineStack align="end">
              <Button
                variant="primary"
                loading={creating}
                disabled={!slug.trim() || !productGid.trim() || !variantGid.trim()}
                onClick={createBundle}
              >
                Create BundleDefinition
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
        {loading ? <LoadingState label="Loading bundle definitions" /> : null}
        {!loading && !error && bundles.length === 0 ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">No bundle definitions</Text>
              <Text as="p" tone="subdued">Create a BundleDefinition through the existing backend workflow before editing its draft revisions.</Text>
            </BlockStack>
          </Card>
        ) : null}
        {!loading && !error && bundles.length > 0 ? (
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "bundle", plural: "bundles" }}
              itemCount={bundles.length}
              selectable={false}
              headings={[
                { title: "Bundle" },
                { title: "Parent binding" },
                { title: "Active" },
                { title: "Draft" },
                { title: "Updated" },
              ]}
            >
              {bundles.map((bundle, index) => (
                <IndexTable.Row id={bundle.bundle_definition_id} key={bundle.bundle_definition_id} position={index}>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Button url={`/app/bundle-admin/${bundle.bundle_definition_id}`} variant="plain">{bundle.slug}</Button>
                      <Text as="span" variant="bodySm" tone="subdued">{bundle.bundle_definition_id}</Text>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm">{bundle.parent_binding.product_gid}</Text>
                    <br />
                    <Text as="span" variant="bodySm" tone="subdued">{bundle.parent_binding.variant_gid}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{revisionBadge(bundle.active_revision_number, "active")}</IndexTable.Cell>
                  <IndexTable.Cell>{revisionBadge(bundle.draft_revision_number, "draft")}</IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" variant="bodySm">{formatTimestamp(bundle.updated_at)}</Text></IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        ) : null}
      </BlockStack>
    </Page>
  );
}

function revisionBadge(revision: number | null, tone: "success" | "attention") {
  return revision == null ? <Text as="span" tone="subdued">None</Text> : <Badge tone={tone}>Revision {revision}</Badge>;
}

export function LoadingState({ label }: { label: string }) {
  return <Box padding="400"><InlineStack gap="200" blockAlign="center"><Spinner accessibilityLabel={label} size="small" /><Text as="span">{label}</Text></InlineStack></Box>;
}

export function InlineError({ title, message }: { title: string; message: string }) {
  return <Card><BlockStack gap="100"><Text as="h2" variant="headingSm">{title}</Text><Text as="p" tone="critical">{message}</Text></BlockStack></Card>;
}
