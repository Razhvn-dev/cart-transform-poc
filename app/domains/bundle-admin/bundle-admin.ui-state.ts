export type BundleAdminError = {
  code: string;
  message: string;
  details?: unknown;
};

export type BundleAdminEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: BundleAdminError };

export type RevisionSummary = {
  revision_id: string;
  revision_number: number;
  status: string;
  configuration?: Record<string, unknown>;
};

export function getEnvelopeError<T>(envelope: BundleAdminEnvelope<T> | undefined) {
  return envelope && !envelope.ok ? envelope.error : null;
}

export function findLatestDraft(revisions: RevisionSummary[]) {
  return revisions
    .filter((revision) => revision.status === "draft")
    .sort((left, right) => right.revision_number - left.revision_number)[0] ?? null;
}

export function parseConfigurationDocument(text: string) {
  try {
    const value: unknown = JSON.parse(text);
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      return { value: null, error: "Configuration document must be a JSON object." };
    }
    return { value: value as Record<string, unknown>, error: null };
  } catch {
    return { value: null, error: "Configuration document contains invalid JSON." };
  }
}

export function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
