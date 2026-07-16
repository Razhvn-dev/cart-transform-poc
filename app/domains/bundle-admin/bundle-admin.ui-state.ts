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
  updated_at?: string;
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

export function getDraftEditorHydrationKey(
  definitionUpdatedAt: string | null | undefined,
  draft: RevisionSummary | null | undefined,
) {
  return `${definitionUpdatedAt ?? ""}:${draft?.revision_id ?? "new"}:${draft?.updated_at ?? ""}`;
}

export function isPersistedDraftConfiguration(
  revisions: RevisionSummary[],
  revisionId: string,
  expectedConfiguration: Record<string, unknown>,
) {
  const revision = revisions.find((candidate) => candidate.revision_id === revisionId);
  return revision?.status === "draft"
    && revision.configuration !== undefined
    && stableJson(revision.configuration) === stableJson(expectedConfiguration);
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

export type StructuredConfigurationSection =
  | "groups"
  | "options"
  | "presets"
  | "compatibility_rules";

type ConfigurationEntity = Record<string, unknown>;

/**
 * Applies a focused edit while preserving the rest of the V1 configuration,
 * including fields introduced by future compatible schema revisions.
 */
export function updateStructuredConfiguration(
  configuration: Record<string, unknown>,
  section: StructuredConfigurationSection,
  identity: { groupKey?: string; entityKey: string },
  patch: Record<string, unknown>,
) {
  const next = structuredClone(configuration) as Record<string, unknown>;

  if (section === "groups") {
    return updateEntityInArray(next, "component_groups", "group_key", identity.entityKey, patch);
  }
  if (section === "presets") {
    return updateEntityInArray(next, "presets", "preset_id", identity.entityKey, patch);
  }
  if (section === "compatibility_rules") {
    return updateEntityInArray(next, "compatibility_rules", "rule_id", identity.entityKey, patch);
  }

  if (!identity.groupKey) {
    return { value: null, error: "An option edit requires a component group." };
  }
  const groups = asEntityArray(next.component_groups);
  if (!groups) return { value: null, error: "Configuration component_groups must be an array." };
  const group = groups.find((candidate) => candidate.group_key === identity.groupKey);
  if (!group) return { value: null, error: `Component group ${identity.groupKey} was not found.` };
  const options = asEntityArray(group.options);
  if (!options) return { value: null, error: `Component group ${identity.groupKey} options must be an array.` };
  const option = options.find((candidate) => candidate.option_key === identity.entityKey);
  if (!option) return { value: null, error: `Option ${identity.entityKey} was not found.` };
  Object.assign(option, patch);
  return { value: next, error: null };
}

export function getStructuredConfigurationEntities(configuration: Record<string, unknown>) {
  const groups = asEntityArray(configuration.component_groups) ?? [];
  return {
    groups,
    presets: asEntityArray(configuration.presets) ?? [],
    compatibilityRules: asEntityArray(configuration.compatibility_rules) ?? [],
  };
}

export function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function updateEntityInArray(
  configuration: Record<string, unknown>,
  arrayKey: string,
  identityKey: string,
  entityKey: string,
  patch: Record<string, unknown>,
) {
  const entities = asEntityArray(configuration[arrayKey]);
  if (!entities) return { value: null, error: `Configuration ${arrayKey} must be an array.` };
  const entity = entities.find((candidate) => candidate[identityKey] === entityKey);
  if (!entity) return { value: null, error: `${identityKey} ${entityKey} was not found.` };
  Object.assign(entity, patch);
  return { value: configuration, error: null };
}

function asEntityArray(value: unknown): ConfigurationEntity[] | null {
  if (!Array.isArray(value) || value.some((candidate) => !candidate || typeof candidate !== "object" || Array.isArray(candidate))) {
    return null;
  }
  return value as ConfigurationEntity[];
}
