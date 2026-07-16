import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate, useParams } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import {
  findLatestDraft,
  formatTimestamp,
  getDraftEditorHydrationKey,
  getEnvelopeError,
  getStructuredConfigurationEntities,
  isPersistedDraftConfiguration,
  parseConfigurationDocument,
  updateStructuredConfiguration,
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

type PublicationCapability = { enabled: boolean; requires_server_evidence: boolean };
type PublicationSummary = {
  publication_id: string;
  revision_id: string;
  revision_number: number;
  state: string;
  created_at: string;
  updated_at: string;
  success: boolean;
  completed_steps: string[];
  failed_step: string | null;
  compensation: Record<string, unknown> | null;
  previous_active_revision_id: string | null;
  active_revision_id: string | null;
  snapshot_checksum: string | null;
  warnings: string[];
};
type BundleDetail = {
  definition: BundleDefinition;
  revisions: Revision[];
  publication?: PublicationCapability;
};
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
  const publicationHistoryFetcher = useFetcher<BundleAdminEnvelope<PublicationSummary[]>>();
  const [slug, setSlug] = useState("");
  const [productGid, setProductGid] = useState("");
  const [variantGid, setVariantGid] = useState("");
  const [configurationText, setConfigurationText] = useState("");
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [selectedOptionKey, setSelectedOptionKey] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [validation, setValidation] = useState<CommandResult | null>(null);
  const [preview, setPreview] = useState<CommandResult | null>(null);
  const [publicationReadiness, setPublicationReadiness] = useState<CommandResult | null>(null);
  const [publication, setPublication] = useState<CommandResult | null>(null);
  const [publicationConfirmation, setPublicationConfirmation] = useState("");
  const [comparison, setComparison] = useState<CommandResult | null>(null);
  const [pendingOperation, setPendingOperation] = useState<string | null>(null);
  const hydratedRevision = useRef<string | null>(null);
  const handledResponse = useRef<unknown>(null);
  const pendingDetailRefresh = useRef<PendingDetailRefresh | null>(null);
  const pendingDraftSave = useRef<{ revisionId: string; configuration: Record<string, unknown> } | null>(null);
  const publicationId = useRef<string | null>(null);
  const publicationHistoryLoadedFor = useRef<string | null>(null);

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
  const publicationHistory = publicationHistoryFetcher.data?.ok ? publicationHistoryFetcher.data.data : null;
  const parsedStructuredConfiguration = parseConfigurationDocument(configurationText);
  const structuredEntities = parsedStructuredConfiguration.value
    ? getStructuredConfigurationEntities(parsedStructuredConfiguration.value)
    : { groups: [], presets: [], compatibilityRules: [] };
  const selectedGroup = structuredEntities.groups.find((group) => group.group_key === selectedGroupKey) ?? structuredEntities.groups[0] ?? null;
  const selectedOptions = asObjectArray(selectedGroup?.options);
  const selectedOption = selectedOptions.find((option) => option.option_key === selectedOptionKey) ?? selectedOptions[0] ?? null;
  const selectedPreset = structuredEntities.presets.find((preset) => preset.preset_id === selectedPresetId) ?? structuredEntities.presets[0] ?? null;
  const selectedRule = structuredEntities.compatibilityRules.find((rule) => rule.rule_id === selectedRuleId) ?? structuredEntities.compatibilityRules[0] ?? null;

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
    if (!parsedStructuredConfiguration.value) return;
    if (selectedGroup && selectedGroup.group_key !== selectedGroupKey) setSelectedGroupKey(stringValue(selectedGroup.group_key));
    if (selectedOption && selectedOption.option_key !== selectedOptionKey) setSelectedOptionKey(stringValue(selectedOption.option_key));
    if (selectedPreset && selectedPreset.preset_id !== selectedPresetId) setSelectedPresetId(stringValue(selectedPreset.preset_id));
    if (selectedRule && selectedRule.rule_id !== selectedRuleId) setSelectedRuleId(stringValue(selectedRule.rule_id));
  }, [parsedStructuredConfiguration.value, selectedGroup, selectedGroupKey, selectedOption, selectedOptionKey, selectedPreset, selectedPresetId, selectedRule, selectedRuleId]);

  useEffect(() => {
    const definitionId = detail?.definition.bundle_definition_id;
    if (!definitionId || publicationHistoryLoadedFor.current === definitionId || publicationHistoryFetcher.state !== "idle") return;
    publicationHistoryLoadedFor.current = definitionId;
    publicationHistoryFetcher.load(`/app/bundle-admin/bundles/${definitionId}/publications`);
  }, [detail?.definition.bundle_definition_id, publicationHistoryFetcher]);

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
    if (pendingOperation === "publish-readiness") setPublicationReadiness(response.data);
    if (pendingOperation === "publish") setPublication(response.data);
    if (pendingOperation === "compare") setComparison(response.data);
    if (["save-definition", "create-draft", "clone-draft", "save-draft", "publish"].includes(pendingOperation ?? "")) {
      if (pendingOperation === "publish") publicationHistoryLoadedFor.current = null;
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
  const publicationHistoryError = getEnvelopeError(publicationHistoryFetcher.data);

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

  function applyStructuredEdit(
    section: "groups" | "options" | "presets" | "compatibility_rules",
    entityKey: string,
    patch: Record<string, unknown>,
    groupKey?: string,
  ) {
    const configuration = readConfiguration();
    if (!configuration) return;
    const result = updateStructuredConfiguration(configuration, section, { entityKey, groupKey }, patch);
    if (result.error || !result.value) {
      setClientError(result.error ?? "Unable to update the configuration section.");
      return;
    }
    setClientError(null);
    setConfigurationText(JSON.stringify(result.value, null, 2));
  }

  function applyIntegerEdit(
    section: "groups" | "options" | "presets" | "compatibility_rules",
    entityKey: string,
    field: string,
    value: string,
    groupKey?: string,
  ) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      setClientError(`${field} must be an integer.`);
      return;
    }
    applyStructuredEdit(section, entityKey, { [field]: parsed }, groupKey);
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

  function runDraftCommand(operation: "validate" | "preview" | "publish-readiness" | "compare", suffix: string) {
    if (!draft) return;
    submit(operation, `/app/bundle-admin/revisions/${draft.revision_id}/${suffix}`, "POST", {});
  }

  function publishDraft() {
    if (!draft || !detail) return;
    const confirmation = `PUBLISH:${detail.definition.bundle_definition_id}:${draft.revision_id}`;
    if (publicationConfirmation !== confirmation) {
      setClientError("Publication confirmation does not match the current draft.");
      return;
    }
    publicationId.current ??= globalThis.crypto.randomUUID();
    submit("publish", `/app/bundle-admin/revisions/${draft.revision_id}/publish`, "POST", {
      publication_id: publicationId.current,
      confirmation,
    });
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
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Publication audit</Text>
                  <Text as="span" tone="subdued">Read-only</Text>
                </InlineStack>
                {publicationHistoryFetcher.state !== "idle" && !publicationHistory ? <Text as="p" tone="subdued">Loading publication records...</Text> : null}
                {publicationHistoryError ? <InlineError title={publicationHistoryError.code} message={publicationHistoryError.message} /> : null}
                {publicationHistory && publicationHistory.length === 0 ? <Text as="p" tone="subdued">No publication attempts have been recorded.</Text> : null}
                {publicationHistory?.map((record) => (
                  <Box key={record.publication_id} paddingBlock="200" borderBlockEndWidth="025" borderColor="border">
                    <InlineStack align="space-between" blockAlign="center" gap="200">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd">Revision {record.revision_number} publication</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{record.publication_id} 路 {formatTimestamp(record.updated_at)}</Text>
                        {record.failed_step ? <Text as="span" tone="critical">Failed at {record.failed_step}</Text> : null}
                      </BlockStack>
                      <Badge tone={record.success ? "success" : "critical"}>{record.success ? "succeeded" : "failed"}</Badge>
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
                <Divider />
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Structured draft editor</Text>
                  <Text as="p" tone="subdued">Use these controlled fields for common configuration changes. Entity IDs and advanced rule conditions remain available through the JSON editor.</Text>
                  {parsedStructuredConfiguration.error ? <InlineError title="Structured editing unavailable" message={parsedStructuredConfiguration.error} /> : null}
                  {!parsedStructuredConfiguration.error && structuredEntities.groups.length === 0 ? <Text as="p" tone="subdued">No component groups are available in this configuration.</Text> : null}
                  {selectedGroup ? <BlockStack gap="200">
                    <Text as="h4" variant="headingSm">Groups</Text>
                    <Select label="Component group" options={structuredEntities.groups.map((group) => ({ label: `${stringValue(group.label) || stringValue(group.group_key)} (${stringValue(group.group_key)})`, value: stringValue(group.group_key) }))} value={stringValue(selectedGroup.group_key)} onChange={setSelectedGroupKey} disabled={requestInFlight} />
                    <InlineStack gap="200" wrap>
                      <TextField label="Group label" value={stringValue(selectedGroup.label)} onChange={(value) => applyStructuredEdit("groups", stringValue(selectedGroup.group_key), { label: value })} autoComplete="off" disabled={requestInFlight} />
                      <TextField label="Display order" type="number" value={numberValue(selectedGroup.display_order)} onChange={(value) => applyIntegerEdit("groups", stringValue(selectedGroup.group_key), "display_order", value)} autoComplete="off" disabled={requestInFlight} />
                      <TextField label="Minimum selections" type="number" value={numberValue(selectedGroup.min)} onChange={(value) => applyIntegerEdit("groups", stringValue(selectedGroup.group_key), "min", value)} autoComplete="off" disabled={requestInFlight} />
                      <TextField label="Maximum selections" type="number" value={numberValue(selectedGroup.max)} onChange={(value) => applyIntegerEdit("groups", stringValue(selectedGroup.group_key), "max", value)} autoComplete="off" disabled={requestInFlight} />
                    </InlineStack>
                    <Checkbox label="Required group" checked={booleanValue(selectedGroup.required)} onChange={(checked) => applyStructuredEdit("groups", stringValue(selectedGroup.group_key), { required: checked })} disabled={requestInFlight} />
                  </BlockStack> : null}
                  {selectedGroup && selectedOption ? <BlockStack gap="200">
                    <Text as="h4" variant="headingSm">Options</Text>
                    <Select label="Option" options={selectedOptions.map((option) => ({ label: `${stringValue(option.label) || stringValue(option.option_key)} (${stringValue(option.option_key)})`, value: stringValue(option.option_key) }))} value={stringValue(selectedOption.option_key)} onChange={setSelectedOptionKey} disabled={requestInFlight} />
                    <InlineStack gap="200" wrap>
                      <TextField label="Option label" value={stringValue(selectedOption.label)} onChange={(value) => applyStructuredEdit("options", stringValue(selectedOption.option_key), { label: value }, stringValue(selectedGroup.group_key))} autoComplete="off" disabled={requestInFlight} />
                      <TextField label="Sort order" type="number" value={numberValue(selectedOption.sort_order)} onChange={(value) => applyIntegerEdit("options", stringValue(selectedOption.option_key), "sort_order", value, stringValue(selectedGroup.group_key))} autoComplete="off" disabled={requestInFlight} />
                      <TextField label="Price cents snapshot" type="number" value={numberValue(selectedOption.price_cents_snapshot)} onChange={(value) => applyIntegerEdit("options", stringValue(selectedOption.option_key), "price_cents_snapshot", value, stringValue(selectedGroup.group_key))} autoComplete="off" disabled={requestInFlight} />
                    </InlineStack>
                    <Checkbox label="Option active" checked={booleanValue(selectedOption.active)} onChange={(checked) => applyStructuredEdit("options", stringValue(selectedOption.option_key), { active: checked }, stringValue(selectedGroup.group_key))} disabled={requestInFlight} />
                  </BlockStack> : null}
                  {selectedPreset ? <BlockStack gap="200">
                    <Text as="h4" variant="headingSm">Presets</Text>
                    <Select label="Preset" options={structuredEntities.presets.map((preset) => ({ label: `${stringValue(preset.label) || stringValue(preset.preset_id)} (${stringValue(preset.preset_id)})`, value: stringValue(preset.preset_id) }))} value={stringValue(selectedPreset.preset_id)} onChange={setSelectedPresetId} disabled={requestInFlight} />
                    <InlineStack gap="200" wrap>
                      <TextField label="Preset label" value={stringValue(selectedPreset.label)} onChange={(value) => applyStructuredEdit("presets", stringValue(selectedPreset.preset_id), { label: value })} autoComplete="off" disabled={requestInFlight} />
                      <TextField label="Display order" type="number" value={numberValue(selectedPreset.display_order)} onChange={(value) => applyIntegerEdit("presets", stringValue(selectedPreset.preset_id), "display_order", value)} autoComplete="off" disabled={requestInFlight} />
                    </InlineStack>
                    <InlineStack gap="400" wrap>
                      <Checkbox label="Preset active" checked={booleanValue(selectedPreset.active)} onChange={(checked) => applyStructuredEdit("presets", stringValue(selectedPreset.preset_id), { active: checked })} disabled={requestInFlight} />
                      <Checkbox label="Validate compatibility" checked={booleanValue(selectedPreset.validate_compatibility)} onChange={(checked) => applyStructuredEdit("presets", stringValue(selectedPreset.preset_id), { validate_compatibility: checked })} disabled={requestInFlight} />
                    </InlineStack>
                  </BlockStack> : null}
                  {selectedRule ? <BlockStack gap="200">
                    <Text as="h4" variant="headingSm">Compatibility rules</Text>
                    <Select label="Rule" options={structuredEntities.compatibilityRules.map((rule) => ({ label: stringValue(rule.rule_id), value: stringValue(rule.rule_id) }))} value={stringValue(selectedRule.rule_id)} onChange={setSelectedRuleId} disabled={requestInFlight} />
                    <InlineStack gap="200" wrap>
                      <TextField label="Priority" type="number" value={numberValue(selectedRule.priority)} onChange={(value) => applyIntegerEdit("compatibility_rules", stringValue(selectedRule.rule_id), "priority", value)} autoComplete="off" disabled={requestInFlight} />
                      <Select label="Status" options={["draft", "active", "archived"].map((value) => ({ label: value, value }))} value={stringValue(selectedRule.status)} onChange={(value) => applyStructuredEdit("compatibility_rules", stringValue(selectedRule.rule_id), { status: value })} disabled={requestInFlight} />
                      <Select label="Effect" options={["allow", "deny", "requires", "excludes", "visibility", "fallback"].map((value) => ({ label: value, value }))} value={stringValue(selectedRule.effect)} onChange={(value) => applyStructuredEdit("compatibility_rules", stringValue(selectedRule.rule_id), { effect: value })} disabled={requestInFlight} />
                      <Select label="Match" options={["all", "any"].map((value) => ({ label: value, value }))} value={stringValue(selectedRule.match)} onChange={(value) => applyStructuredEdit("compatibility_rules", stringValue(selectedRule.rule_id), { match: value })} disabled={requestInFlight} />
                    </InlineStack>
                  </BlockStack> : null}
                </BlockStack>
                <InlineStack gap="200" align="end">
                  {draft ? <Button variant="primary" onClick={saveDraft} loading={requestInFlight}>Save draft</Button> : <Button variant="primary" onClick={createDraft} loading={requestInFlight}>Create draft</Button>}
                  <Button onClick={() => runDraftCommand("validate", "validate")} disabled={!draft || requestInFlight}>Validate</Button>
                  <Button onClick={() => runDraftCommand("preview", "compile-preview")} disabled={!draft || requestInFlight}>Compile preview</Button>
                  <Button onClick={() => runDraftCommand("publish-readiness", "publish-readiness")} disabled={!draft || requestInFlight}>Check publish readiness</Button>
                  <Button onClick={() => runDraftCommand("compare", "compare-active")} disabled={!draft || requestInFlight}>Compare with active</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Layout>
              <Layout.Section>
                <ResultPanel title="Validation result" result={validation} empty="Run validation on the current draft to see configuration errors." />
                <ResultPanel title="Compile preview" result={preview} empty="Compile preview reports checksum, byte size, counts, and size gates without publishing." />
                <ResultPanel title="Publish readiness" result={publicationReadiness} empty="Check the saved draft's local prerequisites. This does not publish or write Runtime Snapshot data." />
                {detail.publication?.enabled && draft ? (
                  <Card>
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingMd">Publish draft</Text>
                      <Text as="p" tone="subdued">{`PUBLISH:${detail.definition.bundle_definition_id}:${draft.revision_id}`}</Text>
                      <TextField
                        label="Publish confirmation"
                        value={publicationConfirmation}
                        onChange={setPublicationConfirmation}
                        autoComplete="off"
                        disabled={requestInFlight}
                      />
                      <InlineStack align="end">
                        <Button
                          variant="primary"
                          tone="critical"
                          onClick={publishDraft}
                          loading={requestInFlight}
                          disabled={requestInFlight || publicationReadiness?.local_preflight_passed !== true}
                        >
                          Publish draft
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                ) : null}
                {detail.publication?.enabled ? <ResultPanel title="Publication result" result={publication} empty="Publication requires a passing readiness check and explicit confirmation." /> : null}
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

function asObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate))
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function booleanValue(value: unknown) {
  return value === true;
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
