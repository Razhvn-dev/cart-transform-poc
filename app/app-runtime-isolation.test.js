import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDirectory = new URL(".", import.meta.url);

async function readAppSource(relativePath) {
  return readFile(fileURLToPath(new URL(relativePath, appDirectory)), "utf8");
}

describe("app server runtime isolation", () => {
  it("does not mutate Cart Transform registration during authentication or home-page access", async () => {
    const [shopifyServer, homeRoute] = await Promise.all([
      readAppSource("shopify.server.ts"),
      readAppSource("routes/app._index.tsx"),
    ]);

    expect(shopifyServer).not.toContain("ensureCartTransformEnabled");
    expect(homeRoute).not.toContain("ensureCartTransformEnabled");
    expect(homeRoute).not.toContain("cartTransformCreate");
  });

  it("does not expose the Remix template's product or price mutations", async () => {
    const homeRoute = await readAppSource("routes/app._index.tsx");

    expect(homeRoute).not.toContain("productCreate");
    expect(homeRoute).not.toContain("productVariantsBulkUpdate");
  });
});
