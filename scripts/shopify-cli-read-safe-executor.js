import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_READ_ONLY_ATTEMPTS = 2;
export const DEFAULT_CLI_TIMEOUT_MS = 45_000;

export class ShopifyCliTransportError extends Error {
  constructor(message, { operationKind, attempts, cause } = {}) {
    super(message, { cause });
    this.name = "ShopifyCliTransportError";
    this.operationKind = operationKind;
    this.attempts = attempts;
  }
}

// Admin mutations are never retried automatically. A lost connection after a
// mutation leaves the write outcome unknown, so the caller must reconcile it.
export function isReadOnlyGraphql(query) {
  return typeof query === "string"
    && /^\s*(?:#graphql\s*)?query\b/i.test(query)
    && !/\bmutation\b/i.test(query);
}

export function isTransientShopifyCliTransportError(error) {
  const message = [error?.message, error?.stderr, error?.cause?.message]
    .filter((value) => typeof value === "string")
    .join("\n")
    .toLowerCase()
    .replace(/[│╭╮╰╯─]+/g, " ")
    .replace(/\s+/g, " ");
  return [
    "socket hang up",
    "socket disconnected before secure tls connection",
    "econnreset",
    "etimedout",
    "eai_again",
    "fetch failed",
    "the user aborted a request",
  ].some((token) => message.includes(token));
}

export function createShopifyCliReadSafeExecutor({
  cliEntrypoint,
  directory,
  execFileAsync,
  root,
  target,
  readFileImpl = readFile,
  wait = defaultWait,
  readOnlyAttempts = DEFAULT_READ_ONLY_ATTEMPTS,
  timeoutMs = DEFAULT_CLI_TIMEOUT_MS,
} = {}) {
  if (!cliEntrypoint || !directory || !execFileAsync || !root || !target) {
    throw new Error("Shopify CLI executor requires entrypoint, directory, command runner, root, and target");
  }
  if (!Number.isInteger(readOnlyAttempts) || readOnlyAttempts < 1) {
    throw new Error("readOnlyAttempts must be a positive integer");
  }

  let requestNumber = 0;
  return async function execute(query, { variables = {} } = {}) {
    const readOnly = isReadOnlyGraphql(query);
    const attempts = readOnly ? readOnlyAttempts : 1;
    let lastError;
    let performedAttempts = 0;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      performedAttempts = attempt;
      const outputFile = join(directory, `response-${requestNumber += 1}.json`);
      try {
        const cliResult = await execFileAsync(process.execPath, [
          cliEntrypoint,
          "app", "execute",
          "--config", target.appConfig,
          "--store", target.store,
          "--version", target.apiVersion,
          "--query", query,
          "--variables", JSON.stringify(variables),
          "--output-file", outputFile,
          "--no-color",
        ], { cwd: root, windowsHide: true, timeout: timeoutMs });
        let outputText;
        try {
          outputText = await readFileImpl(outputFile, "utf8");
        } catch (error) {
          const cliOutput = [cliResult?.stdout, cliResult?.stderr]
            .filter(Boolean)
            .join("\n")
            .trim();
          throw new Error(
            `Shopify CLI did not produce its GraphQL output file${cliOutput ? `: ${cliOutput}` : ""}`,
            { cause: error },
          );
        }
        const payload = JSON.parse(outputText);
        const response = payload?.data ? payload : { data: payload };
        if (!response.data || response.errors?.length) {
          throw new Error(`Shopify Admin GraphQL returned no data: ${JSON.stringify(payload)}`);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (!readOnly || !isTransientShopifyCliTransportError(error) || attempt === attempts) break;
        await wait(250 * attempt);
      }
    }

    const operationKind = readOnly ? "read_only" : "mutation";
    throw new ShopifyCliTransportError(
      readOnly
        ? `Shopify CLI read-only request failed after ${performedAttempts} attempts; no mutation was sent`
        : "Shopify CLI mutation request failed with an unknown remote outcome; reconcile before retrying",
      { operationKind, attempts: readOnly ? performedAttempts : 1, cause: lastError },
    );
  };
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
