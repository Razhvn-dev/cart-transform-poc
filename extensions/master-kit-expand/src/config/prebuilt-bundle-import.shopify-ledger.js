import { PrebuiltBundleImportExecutionError } from "./prebuilt-bundle-import.execution.js";

export function createShopifyPrebuiltBundleImportLedger({ persistence } = {}) {
  if (typeof persistence?.readPrebuiltImportLedger !== "function"
    || typeof persistence?.writePrebuiltImportLedger !== "function") {
    throw new PrebuiltBundleImportExecutionError(
      "UNSUPPORTED_CAPABILITY",
      "Shopify pre-built import ledger persistence requires CAS read and write methods.",
    );
  }
  return Object.freeze({
    read: (sourceIdentity) => persistence.readPrebuiltImportLedger(sourceIdentity),
    write: (record) => persistence.writePrebuiltImportLedger(record),
  });
}

export function createShopifyPrebuiltBundleImportLedgerReader({ persistence } = {}) {
  if (typeof persistence?.readPrebuiltImportLedger !== "function") {
    throw new PrebuiltBundleImportExecutionError(
      "UNSUPPORTED_CAPABILITY",
      "Shopify pre-built import ledger persistence requires a read method.",
    );
  }
  return Object.freeze({
    read: (sourceIdentity) => persistence.readPrebuiltImportLedger(sourceIdentity),
    ...(typeof persistence.readPrebuiltImportLedgers === "function"
      ? { readMany: (sourceIdentities) => persistence.readPrebuiltImportLedgers(sourceIdentities) }
      : {}),
  });
}
