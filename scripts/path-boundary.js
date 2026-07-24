import * as nativePath from "node:path";

export function isPathInside({ root, candidate, pathApi = nativePath }) {
  const relativePath = pathApi.relative(root, candidate);
  return relativePath === "" || (
    relativePath !== ".."
    && !relativePath.startsWith(`..${pathApi.sep}`)
    && !pathApi.isAbsolute(relativePath)
  );
}
