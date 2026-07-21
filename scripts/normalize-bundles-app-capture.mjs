import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  analyzeBundlesAppCapturePrices,
  normalizeBundlesAppCapture,
} from "../extensions/master-kit-expand/src/config/prebuilt-bundle-import.bundles-app-capture.js";

export function parseBundlesAppCaptureArguments(args) {
  const options = { variantsCsvPath: null, productsCsvPath: null, capturePath: null };
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (["--apply", "--write", "--execute", "--output"].includes(key)) {
      throw new Error("this command is read-only and prints normalized records to stdout");
    }
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument "${key}"`);
    if (key === "--variants-csv") options.variantsCsvPath = value;
    else if (key === "--products-csv") options.productsCsvPath = value;
    else if (key === "--capture") options.capturePath = value;
    else throw new Error(`unsupported argument "${key}"`);
    index += 2;
  }
  if (!options.variantsCsvPath || !options.capturePath) {
    throw new Error("usage: node scripts/normalize-bundles-app-capture.mjs --variants-csv <variants.csv> --capture <bundle.json>");
  }
  return options;
}

async function main() {
  const options = parseBundlesAppCaptureArguments(process.argv.slice(2));
  const [variantCsvText, productCsvText, captureDocument] = await Promise.all([
    readFile(resolve(process.cwd(), options.variantsCsvPath), "utf8"),
    options.productsCsvPath ? readFile(resolve(process.cwd(), options.productsCsvPath), "utf8") : null,
    readFile(resolve(process.cwd(), options.capturePath), "utf8").then(JSON.parse),
  ]);
  const normalized = normalizeBundlesAppCapture({
    variant_csv_text: variantCsvText,
    capture_document: captureDocument,
  });
  const result = productCsvText == null ? normalized : {
    ...normalized,
    price_evidence: analyzeBundlesAppCapturePrices({
      product_csv_text: productCsvText,
      capture_document: captureDocument,
    }),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
