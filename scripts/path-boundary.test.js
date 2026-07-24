import { posix, win32 } from "node:path";

import { describe, expect, test } from "vitest";

let isPathInside;
try {
  ({ isPathInside } = await import("./path-boundary.js"));
} catch {
  // The first TDD run intentionally exercises the missing implementation.
}

describe("cross-platform path boundary", () => {
  test.each([
    {
      pathApi: posix,
      root: "/home/devbox/project/.local/staging",
      candidate: "/home/devbox/project/.local/staging/extensions/function/dist/index.wasm",
    },
    {
      pathApi: win32,
      root: "C:\\repo\\.local\\staging",
      candidate: "C:\\repo\\.local\\staging\\extensions\\function\\dist\\index.wasm",
    },
  ])("accepts a nested $pathApi.sep path", ({ pathApi, root, candidate }) => {
    expect(isPathInside?.({ root, candidate, pathApi })).toBe(true);
  });

  test("accepts the root itself", () => {
    expect(isPathInside?.({
      root: "/repo/.local/staging",
      candidate: "/repo/.local/staging",
      pathApi: posix,
    })).toBe(true);
  });

  test.each([
    "/repo/.local/staging-sibling/index.wasm",
    "/repo/.local/index.wasm",
  ])("rejects an escaped Linux path: %s", (candidate) => {
    expect(isPathInside?.({
      root: "/repo/.local/staging",
      candidate,
      pathApi: posix,
    })).toBe(false);
  });
});
