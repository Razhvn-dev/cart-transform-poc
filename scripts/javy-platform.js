const PLATFORM_NAMES = {
  darwin: "macos",
  linux: "linux",
  win32: "windows",
};

const ARCH_NAMES = {
  arm64: "arm",
  x64: "x86_64",
};

export function resolveJavyPlatform({ platform, arch, version }) {
  const platformName = PLATFORM_NAMES[platform];
  const archName = ARCH_NAMES[arch];

  if (!platformName || !archName) {
    throw new Error(`Unsupported Javy host: ${platform}/${arch}`);
  }

  return {
    assetName: `javy-${archName}-${platformName}-v${version}.gz`,
    executableName: `javy-${version}${platform === "win32" ? ".exe" : ""}`,
  };
}
