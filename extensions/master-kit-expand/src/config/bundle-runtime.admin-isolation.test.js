import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTION_ENTRIES = [
  "run.js",
  "run.dev.js",
  "run.dev.stage2.js",
  "run.dev.stage3.js",
  "run.dev.stage4.js",
  "run.dev.stage5.js",
  "run.dev.stage6.js",
  "run.dev.stage7.js",
  "run.dev.stage8.js",
  "run.core.js",
];

describe("Bundle Admin Function isolation", () => {
  it("keeps every Function entry, generated type, and active artifact free of Bundle Admin tokens", () => {
    FUNCTION_ENTRIES.forEach((path) => expectNoBundleAdminTokens(read(path)));
    expectNoBundleAdminTokens(readFileSync(resolve(ROOT, "../generated/api.ts"), "utf8"));

    const artifact = resolve(ROOT, "../dist/function.js");
    if (existsSync(artifact)) expectNoBundleAdminTokens(readFileSync(artifact, "utf8"));
  });
});

function read(path) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function expectNoBundleAdminTokens(text) {
  expect(text).not.toContain("bundle-admin.service");
  expect(text).not.toContain("bundle-admin.in-memory-repository");
  expect(text).not.toContain("createBundleAdminService");
  expect(text).not.toContain("BUNDLE_ADMIN_ERROR_CODES");
}
