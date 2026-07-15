import { execSync } from "node:child_process";
import {
  assertProfileAppConfigAllowed,
  extDir,
  restoreProductionFunctionProfile,
  withTemporaryFunctionProfile,
} from "./function-profile.mjs";

const profile = process.argv[2] || "production";
const appConfigArgIndex = process.argv.indexOf("--app-config");
const appConfig =
  appConfigArgIndex >= 0
    ? process.argv[appConfigArgIndex + 1]
    : process.env.SHOPIFY_APP_CONFIG || null;

function run(cmd) {
  execSync(cmd, { cwd: extDir, stdio: "inherit" });
}

assertProfileAppConfigAllowed(profile, appConfig);

try {
  await withTemporaryFunctionProfile(profile, { appConfig }, async (selected) => {
    console.log(`Generating ${profile} Function types using ${selected.query}`);
    run("npm exec -- shopify app function typegen");
  });
} finally {
  if (profile === "dev") {
    restoreProductionFunctionProfile();
    run("npm exec -- shopify app function typegen");
  }
}
