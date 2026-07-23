import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  PROJECTION_BENCHMARK_GOLDEN_VERSION,
  assertProjectionBenchmarkGoldenFreshness,
  buildProjectionBenchmarkCases,
  buildProjectionMultiLineEnvelopeCases,
  parseHybridSharedCoreGoldenOracle,
  writeRustSpikeFixtures,
} from "./prebuilt-projection-benchmark-fixtures.mjs";

describe("pre-built projection benchmark fixtures", () => {
  test("wires the spike checker to golden freshness and conservative multi-line envelopes", () => {
    const checker = readFileSync(
      new URL("./check-prebuilt-projection-rust-spike.mjs", import.meta.url),
      "utf8",
    );

    expect(checker).toContain("assertProjectionBenchmarkGoldenFreshness");
    expect(checker).toContain("buildProjectionMultiLineEnvelopeCases");
    expect(checker).toContain("benchmark.expectedOutput");
    expect(checker).toContain("classifyConservativeInstructionBudget");
    expect(checker).toContain("shared-core-parity.v1.json");
    expect(checker).toContain("parseHybridSharedCoreGoldenOracle");
    expect(checker).toContain("runProductionSharedCore");
    expect(checker).toContain("--strict-probes");
    expect(checker).toContain("evaluateRustSpikeReleaseGate");
  });

  test("builds the accepted 8/10/12 cases plus real, synthetic, and worst-string 19 component cases", () => {
    const cases = buildProjectionBenchmarkCases();

    expect(cases.map(({ label, componentCount }) => [label, componentCount])).toEqual([
      ["synthetic-8", 8],
      ["real-10", 10],
      ["synthetic-12", 12],
      ["real-19", 19],
      ["synthetic-19", 19],
      ["worst-string-19", 19],
    ]);
    expect(cases[1].input.cart.lines[0].merchandise.id)
      .toBe("gid://shopify/ProductVariant/51592541503766");
    expect(cases[3].input.cart.lines[0].merchandise.id)
      .toBe("gid://shopify/ProductVariant/43369527017678");
    expect(cases[5].input.cart.lines[0].parentTitle.value.length).toBeGreaterThanOrEqual(256);
  });

  test("pins every input and expected output to an implementation-independent golden oracle", () => {
    const cases = buildProjectionBenchmarkCases();

    expect(PROJECTION_BENCHMARK_GOLDEN_VERSION).toBe("prebuilt-projection-golden.v1");
    expect(() => assertProjectionBenchmarkGoldenFreshness(cases)).not.toThrow();
    for (const benchmark of cases) {
      expect(benchmark.expectedOutput.operations).toHaveLength(1);
      expect(benchmark.golden.inputSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(benchmark.golden.outputSha256).toMatch(/^[0-9a-f]{64}$/);
    }

    const stale = structuredClone(cases);
    stale[0].input.cart.lines[0].parentTitle.value = "drifted";
    expect(() => assertProjectionBenchmarkGoldenFreshness(stale))
      .toThrow("synthetic-8 golden input is stale");
  });

  test("builds classified real and worst-string multi-line 19-component boundary probes", () => {
    const cases = buildProjectionMultiLineEnvelopeCases();

    expect(cases.map(({ sourceLabel, lineCount, componentCount, expandedItemCount, expectedBudgetStatus }) => [
      sourceLabel,
      lineCount,
      componentCount,
      expandedItemCount,
    ])).toEqual([
      ["real-19", 2, 19, 38],
      ["real-19", 4, 19, 76],
      ["real-19", 5, 19, 95],
      ["real-19", 6, 19, 114],
      ["real-19", 7, 19, 133],
      ["real-19", 8, 19, 152],
      ["real-19", 10, 19, 190],
      ["real-19", 12, 19, 228],
      ["worst-string-19", 2, 19, 38],
      ["worst-string-19", 3, 19, 57],
    ]);
    expect(cases.map(({ expectedBudgetStatus }) => expectedBudgetStatus)).toEqual([
      "pass",
      "pass",
      "risk-review",
      "fail",
      "fail",
      "fail",
      "fail",
      "fail",
      "risk-review",
      "fail",
    ]);
    for (const benchmark of cases) {
      const bundleIds = benchmark.input.cart.lines.map(({ bundleId }) => bundleId.value);
      expect(new Set(bundleIds).size).toBe(benchmark.lineCount);
      expect(benchmark.expectedOutput.operations).toHaveLength(benchmark.lineCount);
      expect(benchmark.support).toBe("boundary_probe");
    }
  });

  test("validates the optional hybrid Shared Core golden oracle contract", () => {
    const oracle = parseHybridSharedCoreGoldenOracle({
      schema_version: "shared_core_parity.v1",
      cases: [{
        name: "standard",
        metadata: "valid",
        efi: "gid://shopify/ProductVariant/1",
        fuel: "gid://shopify/ProductVariant/2",
        ignition: "gid://shopify/ProductVariant/3",
        display: null,
      }],
    });

    expect(oracle).toEqual({
      schemaVersion: "shared_core_parity.v1",
      cases: [{
        label: "shared-core-standard",
        name: "standard",
        metadata: "valid",
        efi: "gid://shopify/ProductVariant/1",
        fuel: "gid://shopify/ProductVariant/2",
        ignition: "gid://shopify/ProductVariant/3",
        display: null,
      }],
    });
    expect(() => parseHybridSharedCoreGoldenOracle({ schema_version: "wrong", cases: [] }))
      .toThrow("Hybrid Shared Core golden oracle schema_version is invalid");
    expect(() => parseHybridSharedCoreGoldenOracle({
      schema_version: "shared_core_parity.v1",
      cases: [{
        name: "standard",
        metadata: "unknown",
        efi: "gid://shopify/ProductVariant/1",
        fuel: "gid://shopify/ProductVariant/2",
        ignition: "gid://shopify/ProductVariant/3",
        display: null,
      }],
    })).toThrow("Hybrid Shared Core golden oracle case standard metadata is invalid");
  });

  test("writes stable Rust runner fixtures", () => {
    const directory = mkdtempSync(join(tmpdir(), "prebuilt-projection-fixtures-"));

    try {
      const written = writeRustSpikeFixtures(directory);

      expect(written.map((path) => path.split(/[\\/]/).at(-1))).toEqual([
        "valid-8.json",
        "valid-real-10.json",
        "valid-12.json",
        "valid-real-19.json",
        "valid-19.json",
        "valid-worst-string-19.json",
      ]);
      const realTen = JSON.parse(readFileSync(join(directory, "valid-real-10.json"), "utf8"));
      expect(realTen.cart.lines[0].merchandise.id)
        .toBe("gid://shopify/ProductVariant/51592541503766");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
