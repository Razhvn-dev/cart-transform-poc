import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { assessLocalReleaseCandidate } from "./local-release-candidate-readiness.js";

if (process.argv.slice(2).some((argument) => ["--apply", "--write", "--stage", "--commit", "--push", "--deploy"].includes(argument))) {
  throw new Error("this command is read-only and cannot stage, commit, push, or deploy");
}
if (process.argv.length > 2) throw new Error("usage: node scripts/check-local-release-candidate.mjs");

const root = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);
const [{ stdout: statusOutput }, { stdout: trackedOutput }, seedSource, packageSource] = await Promise.all([
  execFileAsync("git", ["status", "--porcelain=v1", "-z"], { cwd: root, encoding: "utf8" }),
  execFileAsync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }),
  readFile(resolve(root, "scripts/seed-test-products.mjs"), "utf8"),
  readFile(resolve(root, "package.json"), "utf8"),
]);

const result = assessLocalReleaseCandidate({
  changes: parsePorcelain(statusOutput),
  existing_paths: trackedOutput.split("\0").filter(Boolean),
  seed_source: seedSource,
  package_document: JSON.parse(packageSource),
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ready_for_release_review ? 0 : 1;

function parsePorcelain(output) {
  return output.split("\0").filter(Boolean).map((record) => ({
    status: record.slice(0, 2),
    path: record.slice(3),
  }));
}
