import { describe, expect, test } from "vitest";
import { resolveJavyPlatform } from "./javy-platform.js";

describe("Javy platform resolution", () => {
  test.each([
    {
      platform: "linux",
      arch: "x64",
      assetName: "javy-x86_64-linux-v9.0.0.gz",
      executableName: "javy-9.0.0",
    },
    {
      platform: "darwin",
      arch: "arm64",
      assetName: "javy-arm-macos-v9.0.0.gz",
      executableName: "javy-9.0.0",
    },
    {
      platform: "win32",
      arch: "x64",
      assetName: "javy-x86_64-windows-v9.0.0.gz",
      executableName: "javy-9.0.0.exe",
    },
  ])(
    "maps $platform/$arch to its official release asset",
    ({ platform, arch, assetName, executableName }) => {
      expect(resolveJavyPlatform({ platform, arch, version: "9.0.0" })).toEqual({
        assetName,
        executableName,
      });
    },
  );

  test.each([
    ["freebsd", "x64"],
    ["linux", "ia32"],
  ])("rejects unsupported host %s/%s", (platform, arch) => {
    expect(() =>
      resolveJavyPlatform({ platform, arch, version: "9.0.0" }),
    ).toThrow(`Unsupported Javy host: ${platform}/${arch}`);
  });
});
