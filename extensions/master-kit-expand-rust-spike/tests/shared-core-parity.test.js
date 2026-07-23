import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import {
  buildFunction,
  getFunctionInfo,
  runFunction,
} from "@shopify/shopify-function-test-helpers";
import { run as runProductionSharedCore } from "../../master-kit-expand/src/run.core.js";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FUNCTION_DIR = path.dirname(TESTS_DIR);
const TARGET = "purchase.cart-transform.run";
const MASTER_KIT_VARIANT_ID =
  "gid://shopify/ProductVariant/51505325605142";
const MASTER_KIT_PRODUCT_ID = "gid://shopify/Product/10600519598358";

const baseInput = JSON.parse(
  fs.readFileSync(path.join(TESTS_DIR, "fixtures", "valid-8.json"), "utf8"),
);
const parityManifest = JSON.parse(
  fs.readFileSync(
    path.join(TESTS_DIR, "fixtures", "shared-core-parity.v1.json"),
    "utf8",
  ),
);

describe("production Shared Core exact-output parity", () => {
  let functionInfo;

  beforeAll(async () => {
    const build = await buildFunction(FUNCTION_DIR);
    expect(build.success, build.error ?? build.output ?? "build failed").toBe(
      true,
    );
    functionInfo = await getFunctionInfo(FUNCTION_DIR);
  }, 45_000);

  test.each(parityManifest.cases)("$name", async (parityCase) => {
    const input = buildInput(parityCase);
    const productionGolden = runProductionSharedCore(input);
    const targetInputQueryPath =
      functionInfo.targeting[TARGET].inputQueryPath;
    const rustResult = await runFunction(
      {
        export: "run",
        input,
        expectedOutput: productionGolden,
        target: TARGET,
      },
      functionInfo.functionRunnerPath,
      functionInfo.wasmPath,
      targetInputQueryPath,
      functionInfo.schemaPath,
    );

    expect(rustResult.error).toBeNull();
    expect(rustResult.result?.output).toEqual(productionGolden);
  }, 10_000);
});

function buildInput(parityCase) {
  const input = structuredClone(baseInput);
  const line = input.cart.lines[0];
  line.id = `gid://shopify/CartLine/parity-${parityCase.name}`;
  line.merchandise.id = MASTER_KIT_VARIANT_ID;
  line.merchandise.product.id = MASTER_KIT_PRODUCT_ID;
  delete line.merchandise.product.prebuiltExpandProjectionMetafield;
  line.parentProductGid = { value: MASTER_KIT_PRODUCT_ID };
  line.parentVariantGid = { value: MASTER_KIT_VARIANT_ID };
  line.builderEfiVariantId = { value: parityCase.efi };
  line.builderFuelVariantId = { value: parityCase.fuel };
  line.builderIgnitionVariantId = { value: parityCase.ignition };
  line.builderDisplayVariantId = parityCase.display
    ? { value: parityCase.display }
    : null;
  if (parityCase.metadata === "legacy") {
    line.bundleId = null;
  }
  return input;
}
