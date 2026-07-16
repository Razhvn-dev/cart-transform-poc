import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { run as runHardcodedCartTransform } from "../extensions/master-kit-expand/src/run.core.js";
import { assertPublicationPromotionEvidence } from "../extensions/master-kit-expand/src/config/bundle-publication.promotion-evidence.js";
import { prepareRuntimeSnapshotCandidates } from "../extensions/master-kit-expand/src/config/bundle-runtime.candidate-promotion.js";
import { buildResolvedRuntimeSnapshotFunctionResult } from "../extensions/master-kit-expand/src/config/bundle-runtime.resolved-candidate-result.js";
import { comparePreparedFunctionResults } from "../extensions/master-kit-expand/src/config/bundle-runtime.result-comparator.js";
import { assertValidRuntimeSnapshot } from "../extensions/master-kit-expand/src/config/bundle-runtime.validator.js";

const DEFAULT_MAX_COMBINATIONS = 64;
const FIXTURE_SET_ID = "bundle-runtime-cart-transform-parity.v1";

export class PublicationPromotionEvidenceBuildError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "PublicationPromotionEvidenceBuildError";
    this.details = details;
  }
}

// This module is an offline release tool. It deliberately imports run.core.js,
// but no app-server module or Function entry imports this script.
export function generatePublicationPromotionEvidence({
  bundleDefinitionId,
  revisionId,
  snapshot,
  fixtureSetId = FIXTURE_SET_ID,
  maxCombinations = DEFAULT_MAX_COMBINATIONS,
}) {
  assertRequiredIdentifier(bundleDefinitionId, "bundleDefinitionId");
  assertRequiredIdentifier(revisionId, "revisionId");
  assertValidRuntimeSnapshot(snapshot);

  const fixtures = enumerateFixtureSelections(snapshot, maxCombinations)
    .map((fixture, index) => buildFixture(snapshot, fixture, index));
  const evidence = {
    schema_version: "bundle_publication_promotion_evidence.v1",
    bundle_definition_id: bundleDefinitionId,
    revision_id: revisionId,
    snapshot_checksum: snapshot.checksum,
    fixture_set_id: fixtureSetId,
    fixtures,
  };

  assertPublicationPromotionEvidence(evidence, {
    bundle_definition_id: bundleDefinitionId,
    revision_id: revisionId,
    snapshot_checksum: snapshot.checksum,
  });
  return evidence;
}

export function enumerateFixtureSelections(snapshot, maxCombinations = DEFAULT_MAX_COMBINATIONS) {
  if (!Number.isInteger(maxCombinations) || maxCombinations < 1) {
    throw new PublicationPromotionEvidenceBuildError("maxCombinations must be a positive integer");
  }

  const optionCounts = snapshot.groups.map((group) => group.options.length);
  const combinations = optionCounts.reduce((total, count) => total * count, 1);
  if (combinations > maxCombinations) {
    throw new PublicationPromotionEvidenceBuildError(
      `runtime fixture combinations (${combinations}) exceed the approved limit (${maxCombinations})`,
      { combinations, maxCombinations },
    );
  }

  const selections = new Map();
  const add = (fixtureId, selection) => {
    const normalized = normalizeSelection(snapshot, selection);
    const signature = snapshot.groups.map((group) => normalized[group.key]).join("|");
    if (!selections.has(signature)) selections.set(signature, { fixtureId, selection: normalized });
  };

  add("defaults", Object.fromEntries(snapshot.groups.map((group) => [group.key, group.default_option])));
  for (const preset of snapshot.presets) add(`preset:${preset.id}`, preset.selections);
  enumerateCombinations(snapshot.groups, 0, {}, (selection) => add("combination", selection));

  return [...selections.values()].map(({ fixtureId, selection }, index) => ({
    fixture_id: fixtureId === "combination" ? `combination:${index + 1}` : fixtureId,
    selections: selection,
  }));
}

function buildFixture(snapshot, fixture, index) {
  const input = buildFunctionInput(snapshot, fixture.selections, index);
  const hardcodedResult = runHardcodedCartTransform(input);
  const prepared = prepareRuntimeSnapshotCandidates(input);
  if (!prepared.ok) {
    throw new PublicationPromotionEvidenceBuildError(
      `fixture "${fixture.fixture_id}" cannot prepare a Runtime Snapshot candidate: ${prepared.reason}`,
    );
  }
  const candidateResult = buildResolvedRuntimeSnapshotFunctionResult(prepared.snapshots);
  const comparison = comparePreparedFunctionResults(hardcodedResult, candidateResult);
  if (!comparison.match || comparison.differences.length > 0) {
    throw new PublicationPromotionEvidenceBuildError(
      `fixture "${fixture.fixture_id}" does not have exact Shared Core parity`,
      { fixture_id: fixture.fixture_id, differences: comparison.differences },
    );
  }
  return {
    fixture_id: fixture.fixture_id,
    hardcoded_result: hardcodedResult,
    candidate_result: candidateResult,
  };
}

function buildFunctionInput(snapshot, selections, index) {
  const cartLine = {
    id: `gid://shopify/CartLine/publication-evidence-${index + 1}`,
    quantity: 1,
    merchandise: {
      __typename: "ProductVariant",
      id: snapshot.parent.variant_gid,
      product: {
        id: snapshot.parent.product_gid,
        runtimeSnapshotDevMetafield: { jsonValue: snapshot },
      },
    },
    bundleId: { value: bundleInstanceId(index + 1) },
    bundleSchemaVersion: { value: "1" },
    parentSku: { value: snapshot.parent.sku },
    parentTitle: { value: snapshot.parent.title },
  };
  for (const group of snapshot.groups) {
    const option = group.options.find((candidate) => candidate.key === selections[group.key]);
    cartLine[cartLineFieldForAttribute(group.cart_attribute)] = { value: option.variant_gid };
  }
  return { cart: { lines: [cartLine] } };
}

function normalizeSelection(snapshot, selection) {
  return Object.fromEntries(snapshot.groups.map((group) => {
    const option = group.options.find((candidate) => candidate.key === selection[group.key]);
    if (!option) {
      throw new PublicationPromotionEvidenceBuildError(
        `fixture selection has no valid option for group "${group.key}"`,
      );
    }
    return [group.key, option.key];
  }));
}

function enumerateCombinations(groups, index, selection, visit) {
  if (index === groups.length) {
    visit(selection);
    return;
  }
  const group = groups[index];
  for (const option of group.options) {
    enumerateCombinations(groups, index + 1, { ...selection, [group.key]: option.key }, visit);
  }
}

function cartLineFieldForAttribute(attribute) {
  return attribute
    .replace(/^_builder_/, "builder_")
    .replace(/^_/, "")
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function bundleInstanceId(index) {
  return `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function assertRequiredIdentifier(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PublicationPromotionEvidenceBuildError(`${field} is required`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.snapshot || !options.bundleDefinitionId || !options.revisionId) {
    throw new PublicationPromotionEvidenceBuildError(
      "usage: node scripts/generate-publication-promotion-evidence.mjs --snapshot <file> --bundle-definition-id <id> --revision-id <id> [--out <file>]",
    );
  }
  const snapshot = JSON.parse(await readFile(resolve(options.snapshot), "utf8"));
  const evidence = generatePublicationPromotionEvidence({
    bundleDefinitionId: options.bundleDefinitionId,
    revisionId: options.revisionId,
    snapshot,
  });
  const output = `${JSON.stringify(evidence, null, 2)}\n`;
  if (options.out) await writeFile(resolve(options.out), output, "utf8");
  else process.stdout.write(output);
}

function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new PublicationPromotionEvidenceBuildError(`invalid argument "${key}"`);
    result[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
