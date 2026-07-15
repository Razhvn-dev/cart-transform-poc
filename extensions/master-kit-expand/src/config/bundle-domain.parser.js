import {
  assertValidBundleDefinition,
  assertValidBundleDomain,
  assertValidBundleRevision,
  assertValidPublicationAttempt,
} from "./bundle-domain.validator.js";

export function normalizeBundleDefinition(definition) {
  return structuredClone(definition);
}

export function parseBundleDefinition(definition) {
  const normalized = normalizeBundleDefinition(definition);
  assertValidBundleDefinition(normalized);
  return deepFreeze(normalized);
}

export function normalizeBundleRevision(revision) {
  return structuredClone(revision);
}

export function parseBundleRevision(revision) {
  const normalized = normalizeBundleRevision(revision);
  assertValidBundleRevision(normalized);
  return normalized.status === "draft" ? normalized : deepFreeze(normalized);
}

export function normalizePublicationAttempt(attempt) {
  return structuredClone(attempt);
}

export function parsePublicationAttempt(attempt) {
  const normalized = normalizePublicationAttempt(attempt);
  assertValidPublicationAttempt(normalized);
  return deepFreeze(normalized);
}

export function parseBundleDomain(domain) {
  const normalized = structuredClone(domain);
  assertValidBundleDomain(normalized);
  return deepFreeze(normalized);
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
