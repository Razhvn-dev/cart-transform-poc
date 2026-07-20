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

export function parseImportReviewDocument(
  text: string,
  fieldName: string,
  expected: "array" | "object" | "json-container",
) {
  try {
    const value: unknown = JSON.parse(text);
    const matchesExpectedShape = expected === "array"
      ? Array.isArray(value)
      : expected === "object"
        ? value != null && typeof value === "object" && !Array.isArray(value)
        : value != null && typeof value === "object";
    if (!matchesExpectedShape) {
      const expectedLabel = expected === "json-container" ? "array or object" : expected;
      return { value: null, error: `${fieldName} must be a JSON ${expectedLabel}.` };
    }
    return { value, error: null };
  } catch {
    return { value: null, error: `${fieldName} contains invalid JSON.` };
  }
}

export type StructuredConfigurationSection =
  | "groups"
  | "options"
  | "presets"
  | "compatibility_rules";

type ConfigurationEntity = Record<string, unknown>;

export type StructuredEntityIdentity = {
  section: StructuredConfigurationSection;
  entityKey: string;
  groupKey?: string;
};

export type StructuredConfigurationReference = {
  source: "component_group" | "preset" | "compatibility_rule";
  sourceId: string;
  field: string;
};

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

/**
 * Finds references that would become invalid when a stable configuration
 * entity is removed. The caller must reject a removal whenever this returns
 * entries, rather than silently rewriting presets or rules.
 */
export function getStructuredConfigurationReferences(
  configuration: Record<string, unknown>,
  identity: StructuredEntityIdentity,
): StructuredConfigurationReference[] {
  const { groups, presets, compatibilityRules } = getStructuredConfigurationEntities(configuration);
  const references: StructuredConfigurationReference[] = [];

  if (identity.section === "groups") {
    for (const preset of presets) {
      const presetId = stringField(preset, "preset_id");
      if (hasOwnField(objectField(preset, "selections"), identity.entityKey)) {
        references.push({ source: "preset", sourceId: presetId, field: `selections.${identity.entityKey}` });
      }
      if (stringArrayField(preset, "locked_selections").includes(identity.entityKey)) {
        references.push({ source: "preset", sourceId: presetId, field: "locked_selections" });
      }
    }
    for (const rule of compatibilityRules) {
      const ruleId = stringField(rule, "rule_id");
      if (objectField(rule, "target").group_key === identity.entityKey) {
        references.push({ source: "compatibility_rule", sourceId: ruleId, field: "target.group_key" });
      }
      asEntityArray(rule.when)?.forEach((condition, index) => {
        if (condition.group_key === identity.entityKey) {
          references.push({ source: "compatibility_rule", sourceId: ruleId, field: `when.${index}.group_key` });
        }
      });
    }
    return references;
  }

  if (identity.section !== "options" || !identity.groupKey) return references;

  const group = groups.find((candidate) => candidate.group_key === identity.groupKey);
  if (group?.default_option_key === identity.entityKey) {
    references.push({ source: "component_group", sourceId: identity.groupKey, field: "default_option_key" });
  }
  for (const preset of presets) {
    if (objectField(preset, "selections")[identity.groupKey] === identity.entityKey) {
      references.push({ source: "preset", sourceId: stringField(preset, "preset_id"), field: `selections.${identity.groupKey}` });
    }
  }
  for (const rule of compatibilityRules) {
    const ruleId = stringField(rule, "rule_id");
    const target = objectField(rule, "target");
    if (target.group_key === identity.groupKey && target.option_key === identity.entityKey) {
      references.push({ source: "compatibility_rule", sourceId: ruleId, field: "target.option_key" });
    }
    asEntityArray(rule.when)?.forEach((condition, index) => {
      if (condition.group_key === identity.groupKey && condition.option_key === identity.entityKey) {
        references.push({ source: "compatibility_rule", sourceId: ruleId, field: `when.${index}.option_key` });
      }
    });
    if (target.group_key === identity.groupKey) {
      for (const field of ["allowed_option_keys", "denied_option_keys", "required_option_keys"] as const) {
        if (stringArrayField(rule, field).includes(identity.entityKey)) {
          references.push({ source: "compatibility_rule", sourceId: ruleId, field });
        }
      }
      if (rule.fallback_option_key === identity.entityKey) {
        references.push({ source: "compatibility_rule", sourceId: ruleId, field: "fallback_option_key" });
      }
    }
  }
  return references;
}

export function removeStructuredConfigurationEntity(
  configuration: Record<string, unknown>,
  identity: StructuredEntityIdentity,
) {
  const references = getStructuredConfigurationReferences(configuration, identity);
  if (references.length > 0) {
    return {
      value: null,
      error: `Cannot remove ${identity.section} ${identity.entityKey} while it is referenced.`,
      references,
    };
  }
  const next = structuredClone(configuration) as Record<string, unknown>;
  if (identity.section === "groups") {
    return removeEntityFromArray(next, "component_groups", "group_key", identity.entityKey);
  }
  if (identity.section === "presets") {
    return removeEntityFromArray(next, "presets", "preset_id", identity.entityKey);
  }
  if (identity.section === "compatibility_rules") {
    return removeEntityFromArray(next, "compatibility_rules", "rule_id", identity.entityKey);
  }
  if (!identity.groupKey) return { value: null, error: "An option removal requires a component group.", references };
  const groups = asEntityArray(next.component_groups);
  const group = groups?.find((candidate) => candidate.group_key === identity.groupKey);
  const options = group ? asEntityArray(group.options) : null;
  if (!options) return { value: null, error: `Component group ${identity.groupKey} options must be an array.`, references };
  if (options.length <= 1) {
    return { value: null, error: `Cannot remove the only option from component group ${identity.groupKey}.`, references };
  }
  const filtered = options.filter((option) => option.option_key !== identity.entityKey);
  if (filtered.length === options.length) return { value: null, error: `Option ${identity.entityKey} was not found.`, references };
  group.options = filtered;
  return { value: next, error: null, references };
}

export function duplicateStructuredConfigurationEntity(
  configuration: Record<string, unknown>,
  section: "presets" | "compatibility_rules",
  entityKey: string,
) {
  const next = structuredClone(configuration) as Record<string, unknown>;
  const [arrayKey, identityKey] = section === "presets"
    ? ["presets", "preset_id"] as const
    : ["compatibility_rules", "rule_id"] as const;
  const entities = asEntityArray(next[arrayKey]);
  if (!entities) return { value: null, error: `Configuration ${arrayKey} must be an array.` };
  const source = entities.find((entity) => entity[identityKey] === entityKey);
  if (!source) return { value: null, error: `${identityKey} ${entityKey} was not found.` };

  const copy = structuredClone(source) as ConfigurationEntity;
  const copyKey = uniqueCopyKey(
    entities,
    identityKey,
    entityKey,
    section === "presets" ? "_copy" : "-copy",
    section === "presets" ? "_" : "-",
  );
  copy[identityKey] = copyKey;
  copy.label = `${stringField(source, "label") || entityKey} copy`;
  if (section === "presets") {
    copy.active = false;
    copy.display_order = nextDisplayOrder(entities);
  } else {
    copy.status = "draft";
    copy.priority = nextPriority(entities);
  }
  entities.push(copy);
  return { value: next, error: null, createdEntity: copy };
}

export function createStructuredConfigurationEntity(
  configuration: Record<string, unknown>,
  section: "presets" | "compatibility_rules",
) {
  const next = structuredClone(configuration) as Record<string, unknown>;
  const groups = asEntityArray(next.component_groups);
  if (!groups || groups.length === 0) {
    return { value: null, error: `Cannot create a ${section === "presets" ? "preset" : "rule"} without component groups.` };
  }
  const defaultSelections = buildActiveDefaultSelections(groups);
  if (!defaultSelections) {
    return { value: null, error: "Each component group needs an active default option before creating this entity." };
  }

  if (section === "presets") {
    const presets = asEntityArray(next.presets);
    if (!presets) return { value: null, error: "Configuration presets must be an array." };
    const preset = {
      preset_id: uniqueCopyKey(presets, "preset_id", "new_preset", "", "_"),
      label: "New preset",
      active: false,
      display_order: nextDisplayOrder(presets),
      validate_compatibility: true,
      selections: defaultSelections,
      locked_selections: [],
    };
    presets.push(preset);
    return { value: next, error: null, createdEntity: preset };
  }

  const rules = asEntityArray(next.compatibility_rules);
  if (!rules) return { value: null, error: "Configuration compatibility_rules must be an array." };
  const [groupKey, optionKey] = Object.entries(defaultSelections)[0];
  const rule = {
    rule_id: uniqueCopyKey(rules, "rule_id", "new-rule", "", "-"),
    priority: nextPriority(rules),
    status: "draft",
    effect: "allow",
    match: "all",
    when: [{ group_key: groupKey, option_key: optionKey, operator: "selected" }],
    target: { group_key: groupKey, option_key: optionKey },
  };
  rules.push(rule);
  return { value: next, error: null, createdEntity: rule };
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

function removeEntityFromArray(
  configuration: Record<string, unknown>,
  arrayKey: string,
  identityKey: string,
  entityKey: string,
) {
  const entities = asEntityArray(configuration[arrayKey]);
  if (!entities) return { value: null, error: `Configuration ${arrayKey} must be an array.`, references: [] };
  const filtered = entities.filter((entity) => entity[identityKey] !== entityKey);
  if (filtered.length === entities.length) return { value: null, error: `${identityKey} ${entityKey} was not found.`, references: [] };
  configuration[arrayKey] = filtered;
  return { value: configuration, error: null, references: [] };
}

function uniqueCopyKey(
  entities: ConfigurationEntity[],
  identityKey: string,
  sourceKey: string,
  suffix: string,
  continuationSeparator: string,
) {
  const keys = new Set(entities.map((entity) => stringField(entity, identityKey)));
  const base = `${sourceKey}${suffix}`;
  let candidate = base;
  let index = 2;
  while (keys.has(candidate)) candidate = `${base}${continuationSeparator}${index++}`;
  return candidate;
}

function nextDisplayOrder(entities: ConfigurationEntity[]) {
  return Math.max(0, ...entities.map((entity) => numericField(entity, "display_order"))) + 10;
}

function nextPriority(entities: ConfigurationEntity[]) {
  return Math.max(0, ...entities.map((entity) => numericField(entity, "priority"))) + 10;
}

function buildActiveDefaultSelections(groups: ConfigurationEntity[]) {
  const selections: Record<string, string> = {};
  for (const group of groups) {
    const groupKey = stringField(group, "group_key");
    const options = asEntityArray(group.options);
    if (!groupKey || !options) return null;
    const defaultOptionKey = stringField(group, "default_option_key");
    const defaultOption = options.find((option) => option.option_key === defaultOptionKey && option.active === true);
    const activeOption = defaultOption ?? options.find((option) => option.active === true);
    if (!activeOption) return null;
    selections[groupKey] = stringField(activeOption, "option_key");
  }
  return selections;
}

function objectField(entity: ConfigurationEntity, key: string): ConfigurationEntity {
  const value = entity[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as ConfigurationEntity : {};
}

function stringArrayField(entity: ConfigurationEntity, key: string) {
  const value = entity[key];
  return Array.isArray(value) ? value.filter((candidate): candidate is string => typeof candidate === "string") : [];
}

function stringField(entity: ConfigurationEntity, key: string) {
  return typeof entity[key] === "string" ? entity[key] : "";
}

function numericField(entity: ConfigurationEntity, key: string) {
  return typeof entity[key] === "number" && Number.isFinite(entity[key]) ? entity[key] : 0;
}

function hasOwnField(entity: ConfigurationEntity, key: string) {
  return Object.prototype.hasOwnProperty.call(entity, key);
}

function asEntityArray(value: unknown): ConfigurationEntity[] | null {
  if (!Array.isArray(value) || value.some((candidate) => !candidate || typeof candidate !== "object" || Array.isArray(candidate))) {
    return null;
  }
  return value as ConfigurationEntity[];
}
