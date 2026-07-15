import {
  prepareFunctionProfile,
  resolveProfile,
} from "./function-profile.mjs";

const profile = process.argv[2] || "production";
const appConfigArgIndex = process.argv.indexOf("--app-config");
const appConfig =
  appConfigArgIndex >= 0
    ? process.argv[appConfigArgIndex + 1]
    : process.env.SHOPIFY_APP_CONFIG || null;
const selected = resolveProfile(profile);

prepareFunctionProfile(profile, { appConfig });

console.log(`Prepared ${profile} Function profile using ${selected.query}`);
