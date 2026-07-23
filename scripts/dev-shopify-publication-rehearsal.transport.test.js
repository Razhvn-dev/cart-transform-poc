import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { DEV_SHOPIFY_APP_CLIENT_ID } from "../extensions/master-kit-expand/src/config/shopify-dev-persistence.adapter.js";
import {
  selectDevPublicationRehearsalTransport,
  selectDevPublicationRehearsalTransportFromArgv,
} from "./dev-shopify-publication-rehearsal.transport.js";
import * as transport from "./dev-shopify-publication-rehearsal.transport.js";

describe("development publication rehearsal transport", () => {
  it("disables session transport even for the locked development client", () => {
    const cliExecutor = vi.fn();
    const sessionExecutor = vi.fn();
    expect(() => selectDevPublicationRehearsalTransport({
      sessionTransport: true,
      cliExecutor,
      sessionExecutor,
      clientId: DEV_SHOPIFY_APP_CLIENT_ID,
    })).toThrow(/session transport.*disabled/i);
    expect(() => selectDevPublicationRehearsalTransport({
      sessionTransport: true,
      cliExecutor,
      sessionExecutor,
      clientId: "wrong-client",
    })).toThrow(/session transport.*disabled/i);
  });

  it("keeps Shopify CLI as the default transport", () => {
    const cliExecutor = vi.fn();
    expect(selectDevPublicationRehearsalTransport({
      sessionTransport: false,
      cliExecutor,
    })).toBe(cliExecutor);
  });

  it("rejects the session transport flag for every command mode", () => {
    const cliExecutor = vi.fn();
    const sessionExecutor = vi.fn();
    expect(() => selectDevPublicationRehearsalTransportFromArgv({
      argv: ["--session-transport"],
      cliExecutor,
      sessionExecutor,
      clientId: DEV_SHOPIFY_APP_CLIENT_ID,
    })).toThrow(/session transport.*disabled/i);
    expect(selectDevPublicationRehearsalTransportFromArgv({
      argv: [],
      cliExecutor,
    })).toBe(cliExecutor);
  });

  it("keeps recovery CLI defaults local and requires exact apply confirmation", () => {
    expect(typeof transport.parseDevPublicationRehearsalCliCommand).toBe("function");

    const operation = "candidate_recovery";
    const confirmation = transport.DEV_PUBLICATION_REHEARSAL_APPLY_CONFIRMATIONS?.[operation];
    expect(confirmation).toContain("cart-transform-poc-dev");
    expect(confirmation).toContain("huang-mvqquz1p.myshopify.com");
    expect(confirmation).toContain("shopify.app.dev.toml");
    expect(transport.parseDevPublicationRehearsalCliCommand({ argv: [], operation }))
      .toMatchObject({ mode: "plan", operation });
    expect(transport.parseDevPublicationRehearsalCliCommand({ argv: ["--help"], operation }))
      .toMatchObject({ mode: "help", operation });
    expect(() => transport.parseDevPublicationRehearsalCliCommand({
      argv: ["--apply"],
      operation,
    })).toThrow(/exact --confirm/);
    expect(() => transport.parseDevPublicationRehearsalCliCommand({
      argv: ["--apply", "--confirm", `${confirmation}-wrong`],
      operation,
    })).toThrow(/exact --confirm/);
    expect(transport.parseDevPublicationRehearsalCliCommand({
      argv: ["--apply", "--confirm", confirmation],
      operation,
    })).toMatchObject({ mode: "apply", operation });
  });

  it("gates the package-exposed baseline recovery and candidate seed mutations", () => {
    for (const operation of ["baseline_recovery", "candidate_seed"]) {
      const confirmation = transport.DEV_PUBLICATION_REHEARSAL_APPLY_CONFIRMATIONS?.[operation];
      expect(confirmation).toContain("cart-transform-poc-dev");
      expect(() => transport.parseDevPublicationRehearsalCliCommand({
        argv: ["--apply"],
        operation,
      })).toThrow(/exact --confirm/);
      expect(transport.parseDevPublicationRehearsalCliCommand({
        argv: ["--apply", "--confirm", confirmation],
        operation,
      })).toMatchObject({ mode: "apply", operation });
    }
  });

  it("rejects session transport for every mutation-capable apply command", () => {
    const operation = "candidate_recovery";
    const confirmation = transport.DEV_PUBLICATION_REHEARSAL_APPLY_CONFIRMATIONS?.[operation];
    expect(() => transport.parseDevPublicationRehearsalCliCommand({
      argv: ["--apply", "--confirm", confirmation, "--session-transport"],
      operation,
    })).toThrow(/session transport.*disabled/i);
    expect(() => transport.parseDevPublicationRehearsalCliCommand({
      argv: ["--reconcile-only", "--session-transport"],
      operation: "full_rehearsal",
    })).toThrow(/session transport.*disabled/i);
  });

  it("requires invocation identity for a CAS apply", () => {
    const operation = "cas_probe";
    const confirmation = transport.DEV_PUBLICATION_REHEARSAL_APPLY_CONFIRMATIONS[operation];
    expect(() => transport.parseDevPublicationRehearsalCliCommand({
      argv: ["--apply", "--confirm", confirmation],
      operation,
    })).toThrow(/probe-id.*owner-nonce/i);
    expect(transport.parseDevPublicationRehearsalCliCommand({
      argv: [
        "--apply", "--confirm", confirmation,
        "--probe-id", "11111111-1111-4111-8111-111111111111",
        "--owner-nonce", "22222222-2222-4222-8222-222222222222",
      ],
      operation,
    })).toMatchObject({
      mode: "apply",
      probeId: "11111111-1111-4111-8111-111111111111",
      ownerNonce: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("disables the former all-in-one mutation path while keeping explicit reconciliation separate", () => {
    expect(transport.parseDevPublicationRehearsalCliCommand({
      argv: [],
      operation: "full_rehearsal",
    })).toMatchObject({ mode: "plan", operation: "full_rehearsal" });
    expect(transport.parseDevPublicationRehearsalCliCommand({
      argv: ["--reconcile-only"],
      operation: "full_rehearsal",
    })).toMatchObject({ mode: "reconcile", operation: "full_rehearsal" });
    expect(() => transport.parseDevPublicationRehearsalCliCommand({
      argv: ["--apply", "--confirm", "anything"],
      operation: "full_rehearsal",
    })).toThrow(/disabled/);
  });

  it("gates every rehearsal mutation CLI before transport setup", () => {
    const scripts = [
      ["execute-dev-shopify-publication-rehearsal.mjs", "await mkdtemp"],
      ["recover-dev-shopify-publication-rehearsal.mjs", "await mkdtemp"],
      ["seed-dev-shopify-publication-rehearsal-candidate.mjs", "await mkdtemp"],
      ["recover-dev-shopify-publication-rehearsal-candidate.mjs", "await mkdtemp"],
      ["recover-dev-shopify-publication-rehearsal-rollback.mjs", "await mkdtemp"],
      ["verify-dev-shopify-publication-rehearsal-cas.mjs", "await mkdtemp"],
    ];

    for (const [filename, transportSetup] of scripts) {
      const source = readFileSync(new URL(filename, import.meta.url), "utf8");
      const gateIndex = source.indexOf("parseDevPublicationRehearsalCliCommand({");
      expect(gateIndex, `${filename} is missing the local command gate`).toBeGreaterThan(-1);
      expect(gateIndex, `${filename} gates after transport setup`)
        .toBeLessThan(source.indexOf(transportSetup));
    }
  });

  it("includes the gated candidate seed in the local recovery plan", () => {
    const source = readFileSync(
      new URL("execute-dev-shopify-publication-rehearsal.mjs", import.meta.url),
      "utf8",
    );
    expect(source).toContain("npm run seed:shopify-publication-rehearsal-candidate:dev");
  });

  it("keeps session transport out of every mutation-capable CLI", () => {
    const mutationScripts = [
      "recover-dev-shopify-publication-rehearsal.mjs",
      "seed-dev-shopify-publication-rehearsal-candidate.mjs",
      "recover-dev-shopify-publication-rehearsal-candidate.mjs",
      "recover-dev-shopify-publication-rehearsal-rollback.mjs",
      "verify-dev-shopify-publication-rehearsal-cas.mjs",
    ];
    for (const filename of mutationScripts) {
      const source = readFileSync(new URL(filename, import.meta.url), "utf8");
      expect(source, `${filename} must use the identity-bound Shopify CLI`)
        .not.toContain("createShopifySessionAdminExecutor");
    }
  });

  it("rejects session transport before setup in every package-exposed diagnostic CLI", () => {
    const diagnosticScripts = [
      ["diagnose-dev-catalog-technical-batch.mjs", "await Promise.all"],
      ["execute-dev-catalog-technical-batch.mjs", "await readFile"],
      ["execute-dev-prebuilt-import-rehearsal.mjs", "await mkdtemp"],
      ["read-dev-rust-hybrid-builder-inventory.mjs", "const identity = assertRustHybridBuilderReadbackIdentity"],
    ];
    for (const [filename, setupMarker] of diagnosticScripts) {
      const source = readFileSync(new URL(filename, import.meta.url), "utf8");
      const rejectionIndex = source.indexOf("session transport is disabled");
      expect(rejectionIndex, `${filename} must reject --session-transport`).toBeGreaterThan(-1);
      expect(rejectionIndex, `${filename} rejects after reading credentials or setting up transport`)
        .toBeLessThan(source.indexOf(setupMarker));
      expect(source, `${filename} must not construct a session executor`)
        .not.toContain("createShopifySessionAdminExecutor");
    }
  });
});
