import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate, useParams } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import {
  findLatestDraft,
  formatTimestamp,
  getDraftEditorHydrationKey,
  getEnvelopeError,
  isPersistedDraftConfiguration,
  parseConfigurationDocument,
  type BundleAdminEnvelope,
  type RevisionSummary,
} from "../domains/bundle-admin/bundle-admin.ui-state";
import { InlineError, LoadingState } from "./app.bundle-admin._index";

type BundleDefinition = {
  bundle_definition_id: string;
  slug: string;
  parent_binding: { product_gid: string; variant_gid: string };
  active_revision_id: string | null;
  updated_at: string;
};

type Revision = RevisionSummary & {
  created_at: string;
  updated_at: string;
  created_by: string;
};

type BundleDetail = { definition: BundleDefinition; revisions: Revision[] };
type CommandResult = Record<string, unknown>;
type PendingDetailRefresh = {
  successMessage: string;
  showToast: boolean;
  expectedDraft?: { revisionId: string; configuration: Record<string, unknown> };
};

export default function BundleAdminDetailPage() {
  const { bundleDefinitionId } = useParams();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const detailFetcher = useFetcher<BundleAdminEnvelope<BundleDetail>>();
  const commandFetcher = useFetcher<BundleAdminEnvelope<CommandResult>>();
  const [slug, setSlug] = useState("");
  const [productGid, setProductGid] = useState("");
  const [variantGid, setVariantGid] = useState("");
  const [configurationText, setConfigurationText] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [validation, setValidation] = useState<CommandResult | null>(null);
  const [preview, setPreview] = useState<CommandResult | null>(null);
  const [comparison, setComparison] = useState<CommandResult | null>(null);
  const [pendingOperation, setPendingOperation] = useState<string | null>(null);
  const hydratedRevision = useRef<string | null>(null);
  const handledResponse = useRef<unknown>(null);
  const pendingDetailRefresh = useRef<PendingDetailRefresh | null>(null);
  const pendingDraftSave = useRef<{ revisionId: string; configuration: Record<string, unknown> } | null>(null);

  useEffect(() => {
    if (bundleDefinitionId && !detailFetcher.data && detailFetcher.state === "idle") {
      detailFetcher.load(`/app/bundle-admin/bundles/${bundleDefinitionId}`);
    }
  }, [bundleDefinitionId, detailFetcher]);

  const refreshDetail = useCallback((pending: PendingDetailRefresh = {
    successMessage: "Bundle detail has been refreshed.",
    showToast: false,
  }) => {
    if (!bundleDefinitionId) return;
    setClientError(null);
    setNotice(null);
    pendingDetailRefresh.current = pending;
    detailFetcher.load(`/app/bundle-admin/bundles/${bundleDefinitionId}`);
  }, [bundleDefinitionId, detailFetcher]);

  const detail = detailFetcher.data?.ok ? detailFetcher.data.data : null;
  const draft = findLatestDraft(detail?.revisions ?? []);
  const parentBindingLocked = (detail?.revisions.length ?? 0) > 0;

  useEffect(() => {
    if (!detail) return;
    const revisionKey = getDraftEditorHydrationKey(detail.definition.updated_at, draft);
    if (hydratedRevision.current === revisionKey) return;
    hydratedRevision.current = revisionKey;
    setSlug(detail.definition.slug);
    setProductGid(detail.definition.parent_binding.product_gid);
    setVariantGid(detail.definition.parent_binding.variant_gid);
    setConfigurationText(draft?.configuration ? JSON.stringify(draft.configuration, null, 2) : "");
  }, [detail, draft]);

  useEffect(() => {
    const pending = pendingDetailRefresh.current;
    if (!pending || detailFetcher.state !== "idle" || !detailFetcher.data) return;
    pendingDetailRefresh.current = null;
    if (!detailFetcher.data.ok) {
      setNotice(null);
      setClientError(`${detailFetcher.data.error.code}: ${detailFetcher.data.error.message}`);
      return;
    }
    if (pending.expectedDraft && !isPersistedDraftConfiguration(
      detailFetcher.data.data.revisions,
      pending.expectedDraft.revisionId,
      pending.expectedDraft.configuration,
    )) {
      setNotice(null);
      setClientError("PERSISTENCE_FAILED: Shopify did not confirm the saved draft after refresh.");
      return;
    }
    setNotice(pending.successMessage);
    if (pending.showToast) shopify.toast.show("Bundle Admin updated");
  }, [detailFetcher.data, detailFetcher.state, shopify]);

  useEffect(() => {
    if (commandFetcher.state !== "idle" || !commandFetcher.data || handledResponse.current === commandFetcher.data) return;
    handledResponse.current = commandFetcher.data;
    const response = commandFetcher.data;
    if (!response.ok) {
      pendingDraftSave.current = null;
      setNotice(null);
      setClientError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    setClientError(null);
    if (pendingOperation === "validate") setValidation(response.data);
    if (pendingOperation === "preview") setPreview(response.data);
    if (pendingOperation === "compare") setComparison(response.data);
    if (["save-definition", "create-draft", "clone-draft", "save-draft"].includes(pendingOperation ?? "")) {
      const expectedDraft = pendingOperation === "save-draft" ? pendingDraftSave.current : undefined;
      pendingDraftSave.current = null;
      refreshDetail({
        successMessage: "Saved. The bundle detail has been refreshed.",
        showToast: true,
        expectedDraft,
      });
    } else if (pendingOperation) {
      setNotice("Command completed.");
      shopify.toast.show("Bundle Admin updated");
    }
  }, [commandFetcher.data, commandFetcher.state, pendingOperation, refreshDetail, shopify]);

  const requestInFlight = commandFetcher.state !== "idle";
  const detailError = getEnvelopeError(detailFetcher.data);
  const commandError = getEnvelopeError(commandFetcher.data);

  function submit(operation: string, action: string, method: "POST" | "PUT", body: Record<string, unknown>) {
    if (operation !== "save-draft") pendingDraftSave.current = null;
    setClientError(null);
    setNotice(null);
    setPendingOperation(operation);
    commandFetcher.submit(JSON.stringify(body), {
      action,
      method,
      encType: "application/json",
    });
  }

  function readConfiguration() {
    const parsed = parseConfigurationDocument(configurationText);
    if (parsed.error) {
      setClientError(parsed.error);
      return null;
    }
    return parsed.value;
  }

  function saveDefinition() {
    if (!bundleDefinitionId) return;
    submit("save-definition", `/app/bundle-admin/bundles/${bundleDefinitionId}`, "PUT", {
      slug,
      parent_binding: { product_gid: productGid, variant_gid: variantGid },
    });
  }

  function createDraft() {
    if (!bundleDefinitionId) return;
    const configuration = readConfiguration();
    if (!configuration) return;
    submit("create-draft", `/app/bundle-admin/bundles/${bundleDefinitionId}/draft-revisions`, "POST", { configuration });
  }

  function cloneActiveRevision() {
    if (!bundleDefinitionId) return;
    submit("clone-draft", `/app/bundle-admin/bundles/${bundleDefinitionId}/clone-active`, "POST", {});
  }

  function saveDraft() {
    if (!draft) return;
    const configuration = readConfiguration();
    if (!configuration) return;
    pendingDraftSave.current = { revisionId: draft.revision_id, configuration };
    submit("save-draft", `/app/bundle-admin/revisions/${draft.revision_id}`, "PUT", { configuration });
  }

  function runDraftCommand(operation: "validate" | "preview" | "compare", suffix: string) {
    if (!draft) return;
    submit(operation, `/app/bundle-admin/revisions/${draft.revision_id}/${suffix}`, "POST", {});
  }

  return (
    <Page
      backAction={{ content: "Bundles", onAction: () => navigate("/app/bundle-admin") }}
      title={detail?.definition.slug ?? "Bundle detail"}
      secondaryActions={[{
        content: detailFetcher.state === "idle" ? "Refresh" : "Refreshing...",
        onAction: () => refreshDetail(),
        loading: detailFetcher.state !== "idle",
        disabled: detailFetcher.state !== "idle",
      }]}
    >
      <TitleBar title={detail?.definition.slug ?? "Bundle detail"} />
      <BlockStack gap="400">
        {detailFetcher.state !== "idle" && !detail ? <LoadingState label="Loading bundle detail" /> : null}
        {detailError ? <InlineError title={detailError.code} message={detailError.message} /> : null}
        {clientError ? <InlineError title="Request needs attention" message={clientError} /> : null}
        {!clientError && commandError ? <InlineError title={commandError.code} message={commandError.message} /> : null}
        {notice ? <Card><Text as="p" tone="success">{notice}</Text></Card> : null}
        {detail ? (
          <>
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">Definition</Text>
                      <Badge tone="info">Development persistence</Badge>
                    </InlineStack>
                    <TextField label="Slug" value={slug} onChange={setSlug} autoComplete="off" disabled={requestInFlight} />
                    <TextField label="Parent product GID" value={productGid} onChange={setProductGid} autoComplete="off" disabled={requestInFlight || parentBindingLocked} helpText={parentBindingLocked ? "Parent binding is locked after the first revision." : undefined} />
                    <TextField label="Parent variant GID" value={variantGid} onChange={setVariantGid} autoComplete="off" disabled={requestInFlight || parentBindingLocked} helpText={parentBindingLocked ? "Parent binding is locked after the first revision." : undefined} />
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodySm" tone="subdued">Updated {formatTimestamp(detail.definition.updated_at)}</Text>
                      <Button variant="primary" onClick={saveDefinition} loading={requestInFlight}>Save definition</Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">Revision state</Text>
                    <RevisionState label="Active revision" revision={detail.revisions.find((revision) => revision.revision_id === detail.definition.active_revision_id) ?? null} tone="success" />
                    <RevisionState label="Current draft" revision={draft} tone="attention" />
                    <Divider />
                    <Button onClick={cloneActiveRevision} disabled={!detail.definition.active_revision_id || !!draft || requestInFlight} loading={requestInFlight}>Clone active revision</Button>
                    <Button onClick={() => document.getElementById("bundle-draft-editor")?.scrollIntoView({ behavior: "smooth" })} disabled={!draft}>Open editor</Button>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Revision history</Text>
                  <Text as="span" tone="subdued">{detail.revisions.length} revisions</Text>
                </InlineStack>
                {detail.revisions.length === 0 ? <Text as="p" tone="subdued">No revisions have been created.</Text> : detail.revisions.map((revision) => (
                  <Box key={revision.revision_id} paddingBlock="200" borderBlockEndWidth="025" borderColor="border">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd">Revision {revision.revision_number}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{revision.revision_id} · {formatTimestamp(revision.updated_at)}</Text>
                      </BlockStack>
                      <Badge tone={revision.status === "published" ? "success" : revision.status === "draft" ? "attention" : "info"}>{revision.status}</Badge>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text as="h2" variant="headingMd" id="bundle-draft-editor">Draft editor</Text>
                    <Text as="p" tone="subdued">Only draft revisions can be saved, validated, compiled, or compared. Runtime Snapshot data is not directly editable.</Text>
                  </BlockStack>
                  {draft ? <Badge tone="attention">Draft revision {draft.revision_number}</Badge> : <Badge>New draft</Badge>}
                </InlineStack>
                <TextField
                  label="Configuration document (JSON)"
                  value={configurationText}
                  onChange={setConfigurationText}
                  multiline={16}
                  monospaced
                  autoComplete="off"
                  disabled={requestInFlight}
                  placeholder='{"schema_version":"bundle_config.v1"}'
                />
                <InlineStack gap="200" align="end">
                  {draft ? <Button variant="primary" onClick={saveDraft} loading={requestInFlight}>Save draft</Button> : <Button variant="primary" onClick={createDraft} loading={requestInFlight}>Create draft</Button>}
                  <Button onClick={() => runDraftCommand("validate", "validate")} disabled={!draft || requestInFlight}>Validate</Button>
                  <Button onClick={() => runDraftCommand("preview", "compile-preview")} disabled={!draft || requestInFlight}>Compile preview</Button>
                  <Button onClick={() => runDraftCommand("compare", "compare-active")} disabled={!draft || requestInFlight}>Compare with active</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Layout>
              <Layout.Section>
                <ResultPanel title="Validation result" result={validation} empty="Run validation on the current draft to see configuration errors." />
                <ResultPanel title="Compile preview" result={preview} empty="Compile preview reports checksum, byte size, counts, and size gates without publishing." />
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <ResultPanel title="Active revision diff" result={comparison ?? (preview?.diff_from_active as CommandResult | undefined) ?? null} empty="Compare the draft against the active revision to inspect structural differences." compact />
              </Layout.Section>
            </Layout>
          </>
        ) : null}
      </BlockStack>
    </Page>
  );
}

function RevisionState({ label, revision, tone }: { label: string; revision: Revision | null; tone: "success" | "attention" }) {
  return <BlockStack gap="050"><Text as="span" variant="bodySm" tone="subdued">{label}</Text>{revision ? <InlineStack gap="100"><Badge tone={tone}>Revision {revision.revision_number}</Badge><Text as="span">{revision.status}</Text></InlineStack> : <Text as="span">None</Text>}</BlockStack>;
}

function ResultPanel({ title, result, empty, compact = false }: { title: string; result: CommandResult | null; empty: string; compact?: boolean }) {
  return <Card>
    <BlockStack gap="200">
      <Text as="h2" variant="headingMd">{title}</Text>
      {result ? <Box padding="300" background="bg-surface-secondary" borderRadius="200" overflowX="scroll"><pre style={{ margin: 0, whiteSpace: compact ? "pre-wrap" : "pre" }}>{JSON.stringify(result, null, 2)}</pre></Box> : <Text as="p" tone="subdued">{empty}</Text>}
    </BlockStack>
  </Card>;
}
