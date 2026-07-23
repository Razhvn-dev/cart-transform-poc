export const DEV_PUBLICATION_REHEARSAL_APPLY_CONFIRMATIONS = Object.freeze({
  baseline_recovery:
    "APPLY baseline_recovery cart-transform-poc-dev huang-mvqquz1p.myshopify.com shopify.app.dev.toml",
  candidate_seed:
    "APPLY candidate_seed cart-transform-poc-dev huang-mvqquz1p.myshopify.com shopify.app.dev.toml",
  candidate_recovery:
    "APPLY candidate_recovery cart-transform-poc-dev huang-mvqquz1p.myshopify.com shopify.app.dev.toml",
  rollback_recovery:
    "APPLY rollback_recovery cart-transform-poc-dev huang-mvqquz1p.myshopify.com shopify.app.dev.toml",
  cas_probe:
    "APPLY cas_probe cart-transform-poc-dev huang-mvqquz1p.myshopify.com shopify.app.dev.toml",
});

export function parseDevPublicationRehearsalCliCommand({ argv = [], operation } = {}) {
  const confirmation = DEV_PUBLICATION_REHEARSAL_APPLY_CONFIRMATIONS[operation];
  const fullRehearsal = operation === "full_rehearsal";
  if (!confirmation && !fullRehearsal) {
    throw new Error(`unsupported development publication rehearsal operation: ${operation}`);
  }
  if (!Array.isArray(argv)) throw new Error("development publication rehearsal argv must be an array");

  const help = argv.includes("--help") || argv.includes("-h");
  const plan = argv.includes("--plan");
  const apply = argv.includes("--apply");
  const reconcile = argv.includes("--reconcile-only");
  const summary = argv.includes("--summary");
  const sessionTransport = argv.includes("--session-transport");
  const confirmIndexes = argv.flatMap((value, index) => value === "--confirm" ? [index] : []);
  const valueOptions = new Set(["--confirm", "--probe-id", "--owner-nonce", "--cleanup-evidence"]);
  const knownValues = new Set([
    "--help", "-h", "--plan", "--apply", "--reconcile-only", "--summary", "--session-transport",
    ...valueOptions,
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (index > 0 && valueOptions.has(argv[index - 1])) continue;
    if (!knownValues.has(value)) {
      throw new Error(`unsupported development publication rehearsal argument: ${value}`);
    }
  }
  if ([help, plan, apply, reconcile].filter(Boolean).length > 1) {
    throw new Error("choose exactly one of --help, --plan, --apply, or --reconcile-only");
  }
  if (confirmIndexes.length > 1) throw new Error("provide exactly one --confirm value");
  const suppliedConfirmation = confirmIndexes.length === 1 ? argv[confirmIndexes[0] + 1] : undefined;
  if (!apply && confirmIndexes.length > 0) {
    throw new Error("--confirm is accepted only with --apply");
  }
  if (reconcile && !fullRehearsal) {
    throw new Error("--reconcile-only is available only for the former full rehearsal command");
  }
  if (summary && !reconcile) {
    throw new Error("--summary is accepted only with --reconcile-only");
  }
  if (sessionTransport) {
    throw new Error("session transport is disabled because persisted sessions have no trusted app identity");
  }
  if (fullRehearsal && apply) {
    throw new Error("the former all-in-one rehearsal mutation path is disabled");
  }
  if (apply && suppliedConfirmation !== confirmation) {
    throw new Error(`apply requires exact --confirm value: ${confirmation}`);
  }
  const probeId = readOption(argv, "--probe-id");
  const ownerNonce = readOption(argv, "--owner-nonce");
  const cleanupEvidence = readOption(argv, "--cleanup-evidence");
  if (operation === "cas_probe" && apply && (!probeId || !ownerNonce)) {
    throw new Error("CAS apply requires both --probe-id and --owner-nonce");
  }
  return Object.freeze({
    mode: help ? "help" : apply ? "apply" : reconcile ? "reconcile" : "plan",
    operation,
    sessionTransport,
    summary,
    confirmation: confirmation ?? null,
    probeId,
    ownerNonce,
    cleanupEvidence,
  });
}

export function selectDevPublicationRehearsalTransport({
  sessionTransport = false,
  cliExecutor,
} = {}) {
  if (typeof cliExecutor !== "function") throw new Error("Shopify CLI executor is required");
  if (!sessionTransport) return cliExecutor;
  throw new Error("session transport is disabled because persisted sessions have no trusted app identity");
}

function readOption(argv, name) {
  const indexes = argv.flatMap((value, index) => value === name ? [index] : []);
  if (indexes.length > 1) throw new Error(`${name} may only be provided once`);
  return indexes.length === 1 ? argv[indexes[0] + 1] ?? null : null;
}

export function selectDevPublicationRehearsalTransportFromArgv({ argv = [], ...options } = {}) {
  return selectDevPublicationRehearsalTransport({
    ...options,
    sessionTransport: argv.includes("--session-transport"),
  });
}
