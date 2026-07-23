import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  getEnvelopeError,
  parseImportReviewDocument,
  type BundleAdminEnvelope,
} from "../domains/bundle-admin/bundle-admin.ui-state";
import {
  createPrebuiltImportDemoData,
  PREBUILT_IMPORT_DEMO_NOTICE,
} from "../domains/bundle-admin/bundle-admin.prebuilt-import-demo";
import { InlineError } from "./app.bundle-admin._index";

const RECORDS_PER_PAGE = 25;

type ImportIssue = {
  code: string;
  message: string;
  path?: string;
  severity?: string;
};

type ImportPlan = {
  mode: "dry_run";
  requires_explicit_confirmation: boolean;
  confirmation_token: string;
  summary: {
    total: number;
    ready_for_confirmation: number;
    needs_review: number;
    rejected: number;
  };
  plan_issues: ImportIssue[];
  package_fingerprint?: string;
  source_export?: {
    source_system?: string;
    collection_mode?: string;
    record_count?: number;
    raw_export_fingerprint?: string;
    mapping_profile_fingerprint?: string;
  };
  records: Array<{
    source_identity: string;
    target_fingerprint: string | null;
    status: string;
    issues: ImportIssue[];
    source: {
      source_system: string | null;
      source_bundle_id: string | null;
      product_series_key: string | null;
      parent_binding: { product_gid?: string; variant_gid?: string } | null;
      component_variant_gids: Array<string | null>;
    };
    target: {
      bundle_definition_id: string;
      parent_binding: { product_gid?: string; variant_gid?: string };
      fixed_selections: Record<string, string>;
    } | null;
  }>;
};

type ImportReviewRequest = Record<string, unknown>;

type RecoveryAssessment = {
  import_id: string;
  status: "ready_for_reconciliation" | "blocked";
  summary: {
    ready_to_execute: number;
    already_completed: number;
    requires_target_reconciliation: number;
    retry_conflict: number;
    not_eligible: number;
  };
  records: Array<{
    source_identity: string;
    target_bundle_definition_id: string | null;
    status: "ready_to_execute" | "already_completed" | "requires_target_reconciliation" | "retry_conflict" | "not_eligible";
    reason: string | null;
  }>;
};

export default function PrebuiltBundleImportReviewPage() {
  const fetcher = useFetcher<BundleAdminEnvelope<ImportPlan>>();
  const recoveryFetcher = useFetcher<BundleAdminEnvelope<RecoveryAssessment>>();
  const [importId, setImportId] = useState("");
  const [sourceRecords, setSourceRecords] = useState("[]");
  const [mappings, setMappings] = useState("[]");
  const [pilotScope, setPilotScope] = useState("{}");
  const [importPackage, setImportPackage] = useState("");
  const [rawSourceExport, setRawSourceExport] = useState("");
  const [sourceMappingProfile, setSourceMappingProfile] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [recordStatusFilter, setRecordStatusFilter] = useState("all");
  const [recordPage, setRecordPage] = useState(1);
  const [demoLoaded, setDemoLoaded] = useState(false);
  const [lastReviewRequest, setLastReviewRequest] = useState<ImportReviewRequest | null>(null);
  const [pendingReviewRequest, setPendingReviewRequest] = useState<ImportReviewRequest | null>(null);
  const [recoverySelection, setRecoverySelection] = useState<string[]>([]);
  const reviewRequestWasSubmitted = useRef(false);
  const loading = fetcher.state !== "idle";
  const assessingRecovery = recoveryFetcher.state !== "idle";
  const error = inputError
    ?? getEnvelopeError(fetcher.data)?.message
    ?? (recoverySelection.length > 0 ? getEnvelopeError(recoveryFetcher.data)?.message : null)
    ?? null;
  const plan = fetcher.data?.ok ? fetcher.data.data : null;
  const recovery = recoverySelection.length > 0 && recoveryFetcher.data?.ok
    ? recoveryFetcher.data.data
    : null;

  useEffect(() => {
    if (fetcher.state !== "idle") {
      reviewRequestWasSubmitted.current = true;
      return;
    }
    if (!reviewRequestWasSubmitted.current || !pendingReviewRequest) return;
    reviewRequestWasSubmitted.current = false;
    if (fetcher.data?.ok) setLastReviewRequest(pendingReviewRequest);
    setPendingReviewRequest(null);
  }, [fetcher.data, fetcher.state, pendingReviewRequest]);

  function submitReviewRequest(request: ImportReviewRequest) {
    setLastReviewRequest(null);
    setPendingReviewRequest(request);
    setRecoverySelection([]);
    fetcher.submit(JSON.stringify(request), {
      method: "post",
      action: "/app/bundle-admin/prebuilt-imports/review",
      encType: "application/json",
    });
  }

  function submitReview() {
    const source = parseImportReviewDocument(sourceRecords, "Source records", "array");
    const mapping = parseImportReviewDocument(mappings, "Mappings", "array");
    const scope = parseImportReviewDocument(pilotScope, "Pilot scope", "object");
    if (!importId.trim()) {
      setInputError("Import ID is required.");
      return;
    }
    if (source.error || mapping.error || scope.error) {
      setInputError(source.error ?? mapping.error ?? scope.error);
      return;
    }
    setInputError(null);
    submitReviewRequest({
      import_id: importId.trim(),
      source_records: source.value,
      mappings: mapping.value,
      pilot_scope: scope.value,
    });
  }

  function submitPackageReview() {
    const parsed = parseImportReviewDocument(importPackage, "Import package", "object");
    if (parsed.error) {
      setInputError(parsed.error);
      return;
    }
    setInputError(null);
    submitReviewRequest({ import_package: parsed.value });
  }

  function submitRawSourceReview() {
    const raw = parseImportReviewDocument(rawSourceExport, "Raw source export", "json-container");
    const profile = parseImportReviewDocument(sourceMappingProfile, "Source mapping profile", "object");
    const mapping = parseImportReviewDocument(mappings, "Mappings", "array");
    const scope = parseImportReviewDocument(pilotScope, "Pilot scope", "object");
    if (!importId.trim()) {
      setInputError("Import ID is required.");
      return;
    }
    if (raw.error || profile.error || mapping.error || scope.error) {
      setInputError(raw.error ?? profile.error ?? mapping.error ?? scope.error);
      return;
    }
    setInputError(null);
    submitReviewRequest({
      import_id: importId.trim(),
      raw_source_export: raw.value,
      source_mapping_profile: profile.value,
      mappings: mapping.value,
      pilot_scope: scope.value,
    });
  }

  function assessRecovery(sourceIdentities: string[]) {
    if (loading || !lastReviewRequest || sourceIdentities.length === 0 || sourceIdentities.length > RECORDS_PER_PAGE) {
      setInputError("Review input and between 1 and 25 visible source records are required for recovery assessment.");
      return;
    }
    setInputError(null);
    setRecoverySelection(sourceIdentities);
    recoveryFetcher.submit(JSON.stringify({
      ...lastReviewRequest,
      source_identities: sourceIdentities,
    }), {
      method: "post",
      action: "/app/bundle-admin/prebuilt-imports/recovery-assessment",
      encType: "application/json",
    });
  }

  function loadDemoData() {
    const demo = createPrebuiltImportDemoData();
    setImportId(demo.import_id);
    setRawSourceExport(JSON.stringify(demo.raw_source_export, null, 2));
    setSourceMappingProfile(JSON.stringify(demo.source_mapping_profile, null, 2));
    setMappings(JSON.stringify(demo.mappings, null, 2));
    setPilotScope(JSON.stringify(demo.pilot_scope, null, 2));
    setImportPackage("");
    setInputError(null);
    setDemoLoaded(true);
  }

  return (
    <Page
      backAction={{ content: "Bundle configurations", url: "/app/bundle-admin" }}
      title="Pre-built import review"
    >
      <TitleBar title="Pre-built import review" />
      <BlockStack gap="400">
        {error ? <InlineError title="Request needs attention" message={error} /> : null}
        <Card>
          <BlockStack gap="300">
            <Text as="p" tone="subdued">
              Review source records and mappings locally before any separate, approved import execution phase.
            </Text>
            <TextField label="Import ID" value={importId} onChange={setImportId} autoComplete="off" />
            <TextField label="Source records (JSON)" value={sourceRecords} onChange={setSourceRecords} multiline={8} autoComplete="off" />
            <TextField label="Mappings (JSON)" value={mappings} onChange={setMappings} multiline={8} autoComplete="off" />
            <TextField label="Pilot scope (JSON)" value={pilotScope} onChange={setPilotScope} multiline={6} autoComplete="off" />
            <InlineStack align="end">
              <Button variant="primary" loading={loading} onClick={submitReview}>Review import</Button>
            </InlineStack>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Raw paid-app export</Text>
            <Text as="p" tone="subdued">
              Normalize an original JSON export through an explicit mapping profile, then run the same write-free review.
            </Text>
            {demoLoaded ? <Text as="p" tone="success">{PREBUILT_IMPORT_DEMO_NOTICE}</Text> : null}
            <TextField label="Raw source export (JSON array or object)" value={rawSourceExport} onChange={setRawSourceExport} multiline={10} autoComplete="off" />
            <TextField label="Source mapping profile (JSON)" value={sourceMappingProfile} onChange={setSourceMappingProfile} multiline={10} autoComplete="off" />
            <InlineStack align="end" gap="200">
              <Button onClick={loadDemoData}>Load demo data (no writes)</Button>
              <Button loading={loading} onClick={submitRawSourceReview}>Normalize and review</Button>
            </InlineStack>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Import package</Text>
            <TextField label="Import package (JSON)" value={importPackage} onChange={setImportPackage} multiline={10} autoComplete="off" />
            <InlineStack align="end">
              <Button loading={loading} onClick={submitPackageReview}>Review package</Button>
            </InlineStack>
          </BlockStack>
        </Card>
        {plan ? <ImportPlanResult
          plan={plan}
          statusFilter={recordStatusFilter}
          onStatusFilterChange={(value) => {
            setRecordStatusFilter(value);
            setRecordPage(1);
          }}
          page={recordPage}
          onPageChange={setRecordPage}
          onAssessRecovery={assessRecovery}
          assessingRecovery={assessingRecovery}
          reviewLoading={loading}
          recovery={recovery}
        /> : null}
      </BlockStack>
    </Page>
  );
}

function ImportPlanResult({
  plan,
  statusFilter,
  onStatusFilterChange,
  page,
  onPageChange,
  onAssessRecovery,
  assessingRecovery,
  reviewLoading,
  recovery,
}: {
  plan: ImportPlan;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  page: number;
  onPageChange: (page: number) => void;
  onAssessRecovery: (sourceIdentities: string[]) => void;
  assessingRecovery: boolean;
  reviewLoading: boolean;
  recovery: RecoveryAssessment | null;
}) {
  const filteredRecords = plan.records.filter((record) => (
    statusFilter === "all" || record.status === statusFilter
  ));
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / RECORDS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * RECORDS_PER_PAGE;
  const pageRecords = filteredRecords.slice(pageStart, pageStart + RECORDS_PER_PAGE);

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">Dry-run result</Text>
            <Badge tone="info">No writes</Badge>
          </InlineStack>
          <InlineStack gap="400" wrap>
            <Count label="Total" value={plan.summary.total} />
            <Count label="Ready" value={plan.summary.ready_for_confirmation} />
            <Count label="Needs review" value={plan.summary.needs_review} />
            <Count label="Rejected" value={plan.summary.rejected} />
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">Confirmation token: {plan.confirmation_token}</Text>
          {plan.source_export ? <Text as="p" variant="bodySm" tone="subdued">
            Source provenance: {plan.source_export.source_system ?? "unknown"} / {plan.source_export.collection_mode ?? "unknown"}
            {typeof plan.source_export.record_count === "number" ? ` / ${plan.source_export.record_count} records` : ""}
            {plan.source_export.raw_export_fingerprint ? ` / export ${plan.source_export.raw_export_fingerprint}` : ""}
          </Text> : null}
          {plan.package_fingerprint ? <Text as="p" variant="bodySm" tone="subdued">Package fingerprint: {plan.package_fingerprint}</Text> : null}
        </BlockStack>
      </Card>
      {plan.plan_issues.length > 0 ? <IssueCard title="Plan issues" issues={plan.plan_issues} /> : null}
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="end" gap="300" wrap>
            <Text as="h2" variant="headingMd">Records</Text>
            <InlineStack gap="200" blockAlign="end" wrap>
              <Select
                label="Record status"
                options={[
                  { label: "All statuses", value: "all" },
                  { label: "Ready for confirmation", value: "ready_for_confirmation" },
                  { label: "Needs review", value: "needs_review" },
                  { label: "Rejected", value: "rejected" },
                ]}
                value={statusFilter}
                onChange={onStatusFilterChange}
              />
              <Button
                loading={assessingRecovery}
                disabled={reviewLoading || pageRecords.length === 0}
                onClick={() => onAssessRecovery(pageRecords.map((record) => record.source_identity))}
              >
                Assess this page (read only)
              </Button>
            </InlineStack>
          </InlineStack>
          {plan.records.length === 0 ? <Text as="p" tone="subdued">No source records were submitted.</Text> : pageRecords.map((record) => (
            <BlockStack key={record.source_identity} gap="100">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" fontWeight="semibold">{record.source_identity}</Text>
                <Badge tone={record.status === "ready_for_confirmation" ? "success" : "attention"}>{record.status}</Badge>
              </InlineStack>
              <ImportRecordMapping record={record} />
              {record.issues.length > 0 ? <IssueList issues={record.issues} /> : null}
            </BlockStack>
          ))}
          {plan.records.length > 0 ? <InlineStack align="space-between" blockAlign="center">
            <Text as="p" tone="subdued" variant="bodySm">
              Showing {filteredRecords.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + RECORDS_PER_PAGE, filteredRecords.length)} of {filteredRecords.length} filtered records
            </Text>
            <InlineStack gap="200">
              <Button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1}>Previous</Button>
              <Text as="span" variant="bodySm">Page {currentPage} of {totalPages}</Text>
              <Button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= totalPages}>Next</Button>
            </InlineStack>
          </InlineStack> : null}
        </BlockStack>
      </Card>
      {recovery ? <RecoveryAssessmentResult assessment={recovery} /> : null}
    </BlockStack>
  );
}

function RecoveryAssessmentResult({ assessment }: { assessment: RecoveryAssessment }) {
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">Recovery assessment</Text>
          <Badge tone={assessment.status === "blocked" ? "critical" : "info"}>Read only</Badge>
        </InlineStack>
        <Text as="p" tone="subdued" variant="bodySm">
          The server re-reviewed the submitted import before reading ledger state. No target writes were attempted.
        </Text>
        <InlineStack gap="400" wrap>
          <Count label="Fresh" value={assessment.summary.ready_to_execute} />
          <Count label="Completed" value={assessment.summary.already_completed} />
          <Count label="Needs reconciliation" value={assessment.summary.requires_target_reconciliation} />
          <Count label="Conflicts" value={assessment.summary.retry_conflict} />
          <Count label="Not eligible" value={assessment.summary.not_eligible} />
        </InlineStack>
        {assessment.records.map((record) => (
          <InlineStack key={record.source_identity} align="space-between" blockAlign="center" gap="200" wrap>
            <BlockStack gap="050">
              <Text as="span" fontWeight="semibold">{record.source_identity}</Text>
              {record.reason ? <Text as="span" tone="subdued" variant="bodySm">{record.reason}</Text> : null}
            </BlockStack>
            <Badge tone={record.status === "already_completed"
              ? "success"
              : record.status === "retry_conflict"
                ? "critical"
                : "attention"}
            >
              {record.status}
            </Badge>
          </InlineStack>
        ))}
      </BlockStack>
    </Card>
  );
}

function ImportRecordMapping({ record }: { record: ImportPlan["records"][number] }) {
  const sourceParent = record.source.parent_binding;
  const targetParent = record.target?.parent_binding;
  const selections = record.target ? Object.entries(record.target.fixed_selections) : [];

  return (
    <BlockStack gap="100">
      <Text as="p" variant="bodySm" tone="subdued">
        Source: {record.source.source_system ?? "unknown"} / {record.source.source_bundle_id ?? "unknown"}
        {record.source.product_series_key ? ` / ${record.source.product_series_key}` : ""}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">Source parent Variant: {sourceParent?.variant_gid ?? "not available"}</Text>
      <Text as="p" variant="bodySm" tone="subdued">
        Source components: {record.source.component_variant_gids.filter(Boolean).join(", ") || "not available"}
      </Text>
      {record.target ? (
        <>
          <Text as="p" variant="bodySm">Target BundleDefinition: {record.target.bundle_definition_id}</Text>
          <Text as="p" variant="bodySm" tone="subdued">Target fingerprint: {record.target_fingerprint ?? "not available"}</Text>
          <Text as="p" variant="bodySm" tone="subdued">Target parent Variant: {targetParent?.variant_gid ?? "not available"}</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Fixed selections: {selections.length > 0
              ? selections.map(([group, option]) => `${group}: ${option}`).join(", ")
              : "not available"}
          </Text>
        </>
      ) : <Text as="p" variant="bodySm" tone="critical">No target mapping has been supplied.</Text>}
    </BlockStack>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return <BlockStack gap="050"><Text as="span" tone="subdued" variant="bodySm">{label}</Text><Text as="span" variant="headingLg">{value}</Text></BlockStack>;
}

function IssueCard({ title, issues }: { title: string; issues: ImportIssue[] }) {
  return <Card><BlockStack gap="200"><Text as="h2" variant="headingMd">{title}</Text><IssueList issues={issues} /></BlockStack></Card>;
}

function IssueList({ issues }: { issues: ImportIssue[] }) {
  return <BlockStack gap="100">{issues.map((issue, index) => <Text as="p" key={`${issue.code}:${issue.path ?? ""}:${index}`} tone="critical">{issue.code}: {issue.message}{issue.path ? ` (${issue.path})` : ""}</Text>)}</BlockStack>;
}
