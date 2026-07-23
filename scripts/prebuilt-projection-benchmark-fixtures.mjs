import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const PROJECTION_BENCHMARK_GOLDEN_VERSION = "prebuilt-projection-golden.v1";

const DEFAULT_LABELS = ["8", "real-10", "12", "real-19", "19", "worst-string-19"];
const MULTI_LINE_SPECS = Object.freeze([
  Object.freeze({ sourceLabel: "real-19", lineCount: 2, expectedBudgetStatus: "pass" }),
  Object.freeze({ sourceLabel: "real-19", lineCount: 4, expectedBudgetStatus: "pass" }),
  Object.freeze({ sourceLabel: "real-19", lineCount: 5, expectedBudgetStatus: "risk-review" }),
  Object.freeze({ sourceLabel: "real-19", lineCount: 6, expectedBudgetStatus: "fail" }),
  Object.freeze({ sourceLabel: "real-19", lineCount: 7, expectedBudgetStatus: "fail" }),
  Object.freeze({ sourceLabel: "real-19", lineCount: 8, expectedBudgetStatus: "fail" }),
  Object.freeze({ sourceLabel: "real-19", lineCount: 10, expectedBudgetStatus: "fail" }),
  Object.freeze({ sourceLabel: "real-19", lineCount: 12, expectedBudgetStatus: "fail" }),
  Object.freeze({ sourceLabel: "worst-string-19", lineCount: 2, expectedBudgetStatus: "risk-review" }),
  Object.freeze({ sourceLabel: "worst-string-19", lineCount: 3, expectedBudgetStatus: "fail" }),
]);

// These hashes are deliberately separate from the fixture constructors. Any fixture
// or oracle change must update an explicit reviewed golden value instead of silently
// following the current JavaScript or Rust Function implementation.
const GOLDEN_HASHES = Object.freeze({
  "synthetic-8": Object.freeze({ inputSha256: "1d17b40e9f66485dbd0e2268490f546abaa29060a7467d4f14421c3e73632854", outputSha256: "2a304ab66d8cbd344d713b2d6d5e1b122d5ccad710117a6453e57447f5c9b964" }),
  "real-10": Object.freeze({ inputSha256: "156680099c38d28b04d5869948ebf98a96439007b453714f886e98e525bec909", outputSha256: "10a4d629edab537df6391dbf4e6351e6c41f6c5af3e6243223f57cccbf597b7c" }),
  "synthetic-12": Object.freeze({ inputSha256: "88e60dafdc1a5dbf42475ae3f53414fd91dfe82bc8a1a87a500daa661dd5c828", outputSha256: "645cb4a183ebb07c4853b642860f45fe9efd60fb1279be35fe7ea05790d6479b" }),
  "real-19": Object.freeze({ inputSha256: "8916e2ed66012f46e30c3cf83e5cbe3b62ca6db88f16ddfdc46b166801108b8c", outputSha256: "591495a32975ffd0550e8f0f6e384786f224bfe536dc9cc9fb72bbd0a0247f13" }),
  "synthetic-19": Object.freeze({ inputSha256: "03d971a0bc35dec7553c47b982c465d0e79638f341195a3bdfd1ed8b6fed1db5", outputSha256: "fcfef9af5cf0461d9a24d315c546d3c5a0dfc0d772845e60386616f1e4d34584" }),
  "worst-string-19": Object.freeze({ inputSha256: "a9792eb8b4757cab397684a11beca20dd6de6a70600b012097f37884295c1c2d", outputSha256: "1ae73605f78e998e9efe083ecd6ff0143584d4b96d69444e0d81789a6ff40633" }),
});

export function buildProjectionBenchmarkCases(labels = DEFAULT_LABELS) {
  return labels.map((value) => {
    const benchmark = buildBenchmarkCase(value);
    return {
      ...benchmark,
      expectedOutput: buildGoldenOutput(benchmark.input),
      golden: GOLDEN_HASHES[benchmark.label] ?? null,
    };
  });
}

export function assertProjectionBenchmarkGoldenFreshness(
  cases = buildProjectionBenchmarkCases(),
) {
  for (const benchmark of cases) {
    if (benchmark.golden == null) {
      throw new Error(`${benchmark.label} has no ${PROJECTION_BENCHMARK_GOLDEN_VERSION} entry`);
    }
    if (sha256(benchmark.input) !== benchmark.golden.inputSha256) {
      throw new Error(`${benchmark.label} golden input is stale`);
    }
    if (sha256(benchmark.expectedOutput) !== benchmark.golden.outputSha256) {
      throw new Error(`${benchmark.label} golden output is stale`);
    }
  }
  return { version: PROJECTION_BENCHMARK_GOLDEN_VERSION, caseCount: cases.length };
}

export function buildProjectionMultiLineEnvelopeCases(specs = MULTI_LINE_SPECS) {
  const sources = new Map(buildProjectionBenchmarkCases([
    "real-19",
    "worst-string-19",
  ]).map((benchmark) => [benchmark.label, benchmark]));
  return specs.map(({ sourceLabel, lineCount, expectedBudgetStatus }) => {
    if (!Number.isSafeInteger(lineCount) || lineCount <= 0) {
      throw new Error(`Invalid cart line count: ${lineCount}`);
    }
    const source = sources.get(sourceLabel);
    if (source == null) throw new Error(`Invalid envelope source: ${sourceLabel}`);
    if (!["pass", "risk-review", "fail"].includes(expectedBudgetStatus)) {
      throw new Error(`Invalid expected budget status: ${expectedBudgetStatus}`);
    }
    const input = {
      cart: {
        lines: Array.from({ length: lineCount }, (_, index) => {
          const line = structuredClone(source.input.cart.lines[0]);
          line.id = `gid://shopify/CartLine/prebuilt-projection-envelope-${index + 1}`;
          line.bundleId.value = envelopeBundleId(index);
          return line;
        }),
      },
    };
    return {
      label: `${sourceLabel}-cart-${lineCount}x19`,
      sourceLabel,
      lineCount,
      componentCount: 19,
      expandedItemCount: lineCount * 19,
      support: "boundary_probe",
      expectedBudgetStatus,
      input,
      expectedOutput: buildGoldenOutput(input),
      sourceGolden: source.golden,
    };
  });
}

export function parseHybridSharedCoreGoldenOracle(document) {
  if (!isPlainObject(document)
    || document.schema_version !== "shared_core_parity.v1") {
    throw new Error("Hybrid Shared Core golden oracle schema_version is invalid");
  }
  if (!Array.isArray(document.cases) || document.cases.length === 0) {
    throw new Error("Hybrid Shared Core golden oracle cases are required");
  }
  const names = new Set();
  const cases = document.cases.map((fixture) => {
    const name = typeof fixture?.name === "string" ? fixture.name.trim() : "";
    if (name === "" || names.has(name)) {
      throw new Error(`Hybrid Shared Core golden oracle case name is invalid: ${name}`);
    }
    names.add(name);
    if (!["valid", "legacy"].includes(fixture.metadata)) {
      throw new Error(`Hybrid Shared Core golden oracle case ${name} metadata is invalid`);
    }
    for (const field of ["efi", "fuel", "ignition"]) {
      if (!isProductVariantGid(fixture[field])) {
        throw new Error(`Hybrid Shared Core golden oracle case ${name} ${field} is invalid`);
      }
    }
    if (fixture.display != null && !isProductVariantGid(fixture.display)) {
      throw new Error(`Hybrid Shared Core golden oracle case ${name} display is invalid`);
    }
    return {
      label: `shared-core-${name}`,
      name,
      metadata: fixture.metadata,
      efi: fixture.efi,
      fuel: fixture.fuel,
      ignition: fixture.ignition,
      display: fixture.display ?? null,
    };
  });
  return { schemaVersion: document.schema_version, cases };
}

export function writeRustSpikeFixtures(outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const written = [];
  for (const benchmark of buildProjectionBenchmarkCases()) {
    const filename = fixtureFilename(benchmark.label, benchmark.componentCount);
    const path = resolve(outputDirectory, filename);
    writeFileSync(path, `${JSON.stringify(benchmark.input, null, 2)}\n`);
    written.push(path);
  }
  return written;
}

function buildBenchmarkCase(value) {
  if (value === "real-10") {
    return { label: "real-10", componentCount: 10, input: buildRealTenInput() };
  }
  if (value === "real-19") {
    return { label: "real-19", componentCount: 19, input: buildRealNineteenInput() };
  }
  if (value === "worst-string-19") {
    return { label: "worst-string-19", componentCount: 19, input: buildWorstStringInput() };
  }
  const componentCount = parseComponentCount(value);
  return {
    label: `synthetic-${componentCount}`,
    componentCount,
    input: buildSyntheticInput(componentCount),
  };
}

function buildRealTenInput() {
  const components = [
    ["component_01_az0004", "gid://shopify/Product/10638465040662", "gid://shopify/ProductVariant/51592714322198", "AZ0004", "EFI Kit Accessories", "3.51"],
    ["component_02_az0010", "gid://shopify/Product/10638462714134", "gid://shopify/ProductVariant/51592667922710", "AZ0010", "Royal Flush", "245.53"],
    ["component_03_az0009", "gid://shopify/Product/10638462615830", "gid://shopify/ProductVariant/51592663925014", "AZ0009", "Royal Flush / Full System Harness", "181.69"],
    ["component_04_ae1052", "gid://shopify/Product/10638462583062", "gid://shopify/ProductVariant/51592663466262", "AE1052", "Coolant Temperature Sensor (CTS)", "14.02"],
    ["component_05_ae1060", "gid://shopify/Product/10638462583062", "gid://shopify/ProductVariant/51592663400726", "AE1060", "System Sensors and Small Electronics", "70.14"],
    ["component_06_ah2500", "gid://shopify/Product/10638465859862", "gid://shopify/ProductVariant/51592722448662", "AH2500", "USB-CAN Cable", "42.08"],
    ["component_07_az0042", "gid://shopify/Product/10638465040662", "gid://shopify/ProductVariant/51592714879254", "AZ0042", "Killshot 2 Pro Black Throttle Body", "140.30"],
    ["component_08_af4005p", "gid://shopify/Product/10638462877974", "gid://shopify/ProductVariant/51592671756566", "AF4005P", "255 In-line Fuel Pump System with PTFE Hose", "329.70"],
    ["component_09_dm300", "gid://shopify/Product/10638465040662", "gid://shopify/ProductVariant/51592715338006", "DM300", "New 5\" / 8\" Handheld Holder", "140.30"],
    ["component_10_as2021", "gid://shopify/Product/10620892315926", "gid://shopify/ProductVariant/51552321175830", "AS2021", "5\" HD Handheld (3rd gen)", "242.72"],
  ].map(toComponent);
  return buildProjectionInput({
    components,
    parent: {
      product_gid: "gid://shopify/Product/10638455767318",
      variant_gid: "gid://shopify/ProductVariant/51592541503766",
      sku: "AS2014B2-FK-4005P",
      title: "Royal Flush Fuel Kits",
    },
    bundleDefinitionId: "9062c47a-68bc-5678-9796-1d055a055321",
    revisionId: "25bf1861-bc5f-5483-9b60-9a45ffd643ff",
    snapshotChecksum: "ea4c9ce1",
    total: "1409.99",
  });
}

function buildRealNineteenInput() {
  const rows = [
    ["AH2500", "gid://shopify/Product/7021699989710", "gid://shopify/ProductVariant/41246330421454", "USB-CAN Cable", "34.50"],
    ["AE1060", "gid://shopify/Product/7461508645070", "gid://shopify/ProductVariant/42716861563086", "WBO2 Sensor", "57.50"],
    ["AZ0032", "gid://shopify/Product/7458154840270", "gid://shopify/ProductVariant/42709192474830", "2-bbl System Throttle Body / Black", "287.55"],
    ["AZ0004", "gid://shopify/Product/7319409623246", "gid://shopify/ProductVariant/42363889680590", "EFI Kit Accessories", "2.87"],
    ["AE1052", "gid://shopify/Product/7461508645070", "gid://shopify/ProductVariant/42716861628622", "Coolant Temperature Sensor (CTS)", "11.49"],
    ["AH2031", "gid://shopify/Product/7319409623246", "gid://shopify/ProductVariant/42993220452558", "Deuces Wild 2 / Full System Harness", "115.01"],
    ["DM300", "gid://shopify/Product/7319409623246", "gid://shopify/ProductVariant/42930212831438", "New 5\" / 8\" Handheld Holder", "115.01"],
    ["DE100", "gid://shopify/Product/7319409623246", "gid://shopify/ProductVariant/42516249936078", "Magnetic Distributor Extension Wire", "115.01"],
    ["AD2013", "gid://shopify/Product/6619104903374", "gid://shopify/ProductVariant/39599583264974", "Black Jack Pro Distributor / 351W SBF", "189.78"],
    ["AF4015", "gid://shopify/Product/7321047466190", "gid://shopify/ProductVariant/42371461644494", "Tight Fit In-Tank Pump Module (255 LPH)", "143.77"],
    ["AF2018G", "gid://shopify/Product/7417744064718", "gid://shopify/ProductVariant/42639911157966", "Fuel Regulator With Gauge", "63.25"],
    ["AF4102", "gid://shopify/Product/7321394610382", "gid://shopify/ProductVariant/42371479208142", "40' PTFE Hose Kit", "276.05"],
    ["AC2008", "gid://shopify/Product/6618908328142", "gid://shopify/ProductVariant/42614793339086", "Black Jack Pro Series Ignition Coil", "28.75"],
    ["AF4015-V", "gid://shopify/Product/7652580524238", "gid://shopify/ProductVariant/43331544809678", "Tight Fit In-Tank Fuel Pump - Verified", "0.00"],
    ["AZ0040", "gid://shopify/Product/7531963809998", "gid://shopify/ProductVariant/42930540773582", "Power Distribution Module (PDM)", "57.50"],
    ["IR0013", "gid://shopify/Product/7525803720910", "gid://shopify/ProductVariant/42979446554830", "New 5\" / 8\" Handheld Cable", "0.00"],
    ["AH2041", "gid://shopify/Product/7319409623246", "gid://shopify/ProductVariant/43152864903374", "Main Relay and Fuel Pump Relay Harness", "23.00"],
    ["AS2039", "gid://shopify/Product/7608924799182", "gid://shopify/ProductVariant/43159046324430", "8\" HD Handheld", "373.82"],
    ["AS2031", "gid://shopify/Product/7456726417614", "gid://shopify/ProductVariant/43591896432846", "Deuces Wild 2 ECU", "115.13"],
  ];
  const components = rows.map(([sku, product_gid, variant_gid, title, fixed_price_per_unit], index) => toComponent([
    `component_${String(index + 1).padStart(2, "0")}_${sku.toLowerCase()}`,
    product_gid,
    variant_gid,
    sku,
    title,
    fixed_price_per_unit,
  ], index));
  return buildProjectionInput({
    components,
    parent: {
      product_gid: "gid://shopify/Product/7611388362958",
      variant_gid: "gid://shopify/ProductVariant/43369527017678",
      sku: "AS2031B6-MK-2013-4016",
      title: "Deuces Wild Master Kit / 8-inch / 351W / 40-foot PTFE",
    },
    bundleDefinitionId: "72c3e18c-4254-52c4-99c5-73b4ad7b7a19",
    revisionId: "a4a5aa1c-b0e2-50e2-bcb8-55d344460619",
    snapshotChecksum: "0c94c5b2",
    total: "2009.99",
  });
}

function buildSyntheticInput(componentCount) {
  const components = Array.from({ length: componentCount }, (_, index) => ({
    sequence: index + 1,
    group: `group_${index + 1}`,
    role: `role_${index + 1}`,
    product_gid: `gid://shopify/Product/${10_000_000_000_001 + index}`,
    variant_gid: `gid://shopify/ProductVariant/${20_000_000_000_001 + index}`,
    sku: `SKU-${String(index + 1).padStart(2, "0")}`,
    title: `Component ${index + 1}`,
    fixed_price_per_unit: "10.00",
  }));
  return buildProjectionInput({
    components,
    parent: {
      product_gid: "gid://shopify/Product/10638456357142",
      variant_gid: "gid://shopify/ProductVariant/51592577089814",
      sku: "AS2014B2-MK-2011-4005P",
      title: "AS2014B2-MK-2011-4005P",
    },
    bundleDefinitionId: "7bd39574-70f2-5d52-b8af-4c1717d6f390",
    revisionId: "f8344a2c-1bfc-5bf6-942f-50bcf9a3be94",
    snapshotChecksum: "92644e9b",
    total: `${componentCount * 10}.00`,
  });
}

function buildWorstStringInput() {
  const long = (prefix, minimumLength) => {
    const pattern = `${prefix}|ACES/quote-"/雪/EFI/`;
    return pattern.repeat(Math.ceil(minimumLength / pattern.length)).slice(0, minimumLength);
  };
  const components = Array.from({ length: 19 }, (_, index) => ({
    sequence: index + 1,
    group: long(`group-${index + 1}`, 128),
    role: long(`role-${index + 1}`, 128),
    product_gid: `gid://shopify/Product/${30_000_000_000_001 + index}`,
    variant_gid: `gid://shopify/ProductVariant/${40_000_000_000_001 + index}`,
    sku: long(`SKU-${index + 1}`, 128),
    title: long(`Component-${index + 1}`, 512),
    fixed_price_per_unit: "10.00",
  }));
  const parentTitle = long("Worst-case parent", 512);
  return buildProjectionInput({
    components,
    parent: {
      product_gid: "gid://shopify/Product/39999999999999",
      variant_gid: "gid://shopify/ProductVariant/49999999999999",
      sku: long("PARENT-SKU", 128),
      title: parentTitle,
    },
    bundleDefinitionId: "ffffffff-ffff-4fff-8fff-fffffffffff1",
    revisionId: "ffffffff-ffff-4fff-8fff-fffffffffff2",
    snapshotChecksum: "ffffffff",
    total: "190.00",
  });
}

function buildProjectionInput({ components, parent, bundleDefinitionId, revisionId, snapshotChecksum, total }) {
  const projection = {
    schema_version: "prebuilt_bundle_expand_projection.v1",
    checksum_algorithm: "fnv1a-32",
    bundle_definition_id: bundleDefinitionId,
    published_revision_id: revisionId,
    source_snapshot_checksum: snapshotChecksum,
    parent,
    components,
  };
  projection.checksum = calculateGoldenProjectionChecksum(projection);
  return {
    cart: {
      lines: [{
        id: "gid://shopify/CartLine/prebuilt-projection-budget",
        quantity: 1,
        cost: { amountPerQuantity: { amount: total } },
        bundleId: { value: "11111111-1111-4111-8111-111111111111" },
        bundleSchemaVersion: { value: "1" },
        parentProductGid: { value: projection.parent.product_gid },
        parentVariantGid: { value: projection.parent.variant_gid },
        parentSku: { value: projection.parent.sku },
        parentTitle: { value: projection.parent.title },
        builderEfiVariantId: null,
        builderFuelVariantId: null,
        builderIgnitionVariantId: null,
        builderDisplayVariantId: null,
        merchandise: {
          __typename: "ProductVariant",
          id: projection.parent.variant_gid,
          product: {
            id: projection.parent.product_gid,
            prebuiltExpandProjectionMetafield: { jsonValue: projection },
          },
        },
      }],
    },
  };
}

function buildGoldenOutput(input) {
  return {
    operations: input.cart.lines.map((line) => {
      const projection = line.merchandise.product.prebuiltExpandProjectionMetafield.jsonValue;
      return {
        expand: {
          cartLineId: line.id,
          expandedCartItems: projection.components.map((component) => ({
            attributes: [
              attribute("_bundle_id", line.bundleId.value),
              attribute("_bundle_schema_version", line.bundleSchemaVersion.value),
              attribute("_parent_product_gid", projection.parent.product_gid),
              attribute("_parent_variant_gid", projection.parent.variant_gid),
              attribute("_parent_sku", projection.parent.sku),
              attribute("_parent_title", projection.parent.title),
              attribute("_component_group", component.group),
              attribute("_component_role", component.role),
              attribute("_component_variant_gid", component.variant_gid),
              attribute("_component_sequence", String(component.sequence)),
            ],
            merchandiseId: component.variant_gid,
            price: {
              adjustment: {
                fixedPricePerUnit: { amount: component.fixed_price_per_unit },
              },
            },
            quantity: 1,
          })),
          title: projection.parent.title,
        },
      };
    }),
  };
}

function calculateGoldenProjectionChecksum(projection) {
  const canonical = {
    bundle_definition_id: projection.bundle_definition_id,
    checksum_algorithm: projection.checksum_algorithm,
    components: projection.components.map((component) => ({
      fixed_price_per_unit: component.fixed_price_per_unit,
      group: component.group,
      product_gid: component.product_gid,
      role: component.role,
      sequence: component.sequence,
      sku: component.sku,
      title: component.title,
      variant_gid: component.variant_gid,
    })),
    parent: {
      product_gid: projection.parent.product_gid,
      sku: projection.parent.sku,
      title: projection.parent.title,
      variant_gid: projection.parent.variant_gid,
    },
    published_revision_id: projection.published_revision_id,
    schema_version: projection.schema_version,
    source_snapshot_checksum: projection.source_snapshot_checksum,
  };
  return fnv1a32(JSON.stringify(canonical));
}

function toComponent([group, product_gid, variant_gid, sku, title, fixed_price_per_unit], index) {
  return {
    sequence: index + 1,
    group,
    role: "fixed_component",
    product_gid,
    variant_gid,
    sku,
    title,
    fixed_price_per_unit,
  };
}

function fixtureFilename(label, componentCount) {
  if (label === "real-10") return "valid-real-10.json";
  if (label === "real-19") return "valid-real-19.json";
  if (label === "worst-string-19") return "valid-worst-string-19.json";
  return `valid-${componentCount}.json`;
}

function envelopeBundleId(index) {
  return `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`;
}

function attribute(key, value) {
  return { key, value };
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isProductVariantGid(value) {
  return typeof value === "string"
    && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(value);
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseComponentCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error(`Invalid component count: ${value}`);
  return count;
}
