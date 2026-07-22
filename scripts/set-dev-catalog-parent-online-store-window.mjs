import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createShopifyCliReadSafeExecutor } from "./shopify-cli-read-safe-executor.js";

const PARENTS = Object.freeze({
  "AD2011-C": "gid://shopify/Product/10638459273494",
  "AD2023-C": "gid://shopify/Product/10638459240726",
});
const sku = readOption("--sku");
const productId = PARENTS[sku];
if (!productId) throw new Error("--sku must be AD2011-C or AD2023-C");
const requestedState = readOption("--state");
if (!["published", "unpublished"].includes(requestedState)) throw new Error("--state must be published or unpublished");
const expectedPreviousState = requestedState === "published" ? "unpublished" : "published";
const confirmation = `SET-ONLINE-STORE:${sku}:${expectedPreviousState}->${requestedState}`;
const apply = process.argv.includes("--apply");
if (apply && readOption("--confirm") !== confirmation) throw new Error(`--apply requires --confirm ${confirmation}`);

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "aces-dev-catalog-online-store-"));
const execute = createShopifyCliReadSafeExecutor({
  cliEntrypoint: join(root, "node_modules", "@shopify", "cli", "bin", "run.js"),
  directory,
  execFileAsync: promisify(execFile),
  root,
  target: { appConfig: "shopify.app.dev.toml", store: "huang-mvqquz1p.myshopify.com", apiVersion: "2026-04" },
  readOnlyAttempts: 8,
  timeoutMs: 60_000,
});

try {
  const before = await readState();
  if (before.state === requestedState) {
    process.stdout.write(`${JSON.stringify({ status: "already_at_target", sku, productId, before }, null, 2)}\n`);
  } else if (before.state !== expectedPreviousState) {
    throw new Error(`${sku} Online Store state drift: expected ${expectedPreviousState}, observed ${before.state}`);
  } else if (!apply) {
    process.stdout.write(`${JSON.stringify({ status: "read_only_ready", sku, productId, before, requestedState, confirmation }, null, 2)}\n`);
  } else {
    const mutationName = requestedState === "published" ? "publishablePublish" : "publishableUnpublish";
    const payload = await execute(`#graphql
      mutation SetDevCatalogParentOnlineStore($id: ID!, $input: [PublicationInput!]!) {
        ${mutationName}(id: $id, input: $input) {
          userErrors { field message code }
        }
      }
    `, { variables: { id: productId, input: [{ publicationId: before.publication_id }] } });
    const result = payload.data?.[mutationName];
    if (result?.userErrors?.length) throw new Error(`publication mutation rejected: ${JSON.stringify(result.userErrors)}`);
    const after = await readState();
    if (after.state !== requestedState) throw new Error(`publication read-back mismatch: ${JSON.stringify(after)}`);
    process.stdout.write(`${JSON.stringify({ status: "set_and_verified", sku, productId, before, after }, null, 2)}\n`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function readState() {
  const payload = await execute(`#graphql
    query ReadDevCatalogParentOnlineStore($productId: ID!) {
      publications(first: 50) { nodes { id name catalog { title } } }
      product(id: $productId) {
        id title handle status onlineStoreUrl
        resourcePublicationsV2(first: 50) {
          nodes { isPublished publication { id name catalog { title } } }
        }
      }
    }
  `, { variables: { productId } });
  const product = payload.data?.product;
  if (product?.id !== productId || product.status !== "ACTIVE") throw new Error("publication target identity or product status drift");
  const publication = payload.data.publications.nodes.find((candidate) =>
    candidate.name === "Online Store" || candidate.catalog?.title === "Online Store");
  if (!publication) throw new Error("Online Store publication was not found");
  const resource = product.resourcePublicationsV2.nodes.find((candidate) => candidate.publication?.id === publication.id);
  const published = resource?.isPublished === true;
  return {
    publication_id: publication.id,
    publication_name: publication.name,
    state: published ? "published" : "unpublished",
    online_store_url: product.onlineStoreUrl,
    handle: product.handle,
  };
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
