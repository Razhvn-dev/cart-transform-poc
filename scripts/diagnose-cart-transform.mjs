import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const store = "huang-mvqquz1p.myshopify.com";

function run(query, variables = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "diag-"));
  const queryFile = join(tempDir, "q.graphql");
  const variableFile = join(tempDir, "v.json");
  writeFileSync(queryFile, query, "utf8");
  writeFileSync(variableFile, JSON.stringify(variables), "utf8");
  try {
    const stdout = execSync(
      `shopify store execute --store ${store} --version 2026-04 --json --query-file "${queryFile}" --variable-file "${variableFile}"`,
      { encoding: "utf8" },
    );
    return JSON.parse(stdout);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const products = run(
  `query { products(first: 5, query: "title:Master Kit Test") { nodes { id title handle variants(first:1){nodes{id title}} } } }`,
);
console.log("Product:", JSON.stringify(products, null, 2));

try {
  const transforms = run(`query { cartTransforms(first: 10) { nodes { id functionId } } }`);
  console.log("CartTransforms:", JSON.stringify(transforms, null, 2));
} catch (e) {
  console.log("CartTransforms query failed:", e.message?.slice(0, 200));
}

try {
  const features = run(`query { shop { features { cartTransform } } }`);
  console.log("Features:", JSON.stringify(features, null, 2));
} catch (e) {
  console.log("Features query failed:", e.message?.slice(0, 200));
}
