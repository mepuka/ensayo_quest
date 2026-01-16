export type AsrShimModule = "fs" | "path" | "url";

export const resolveAsrShimPath = (moduleName: AsrShimModule) =>
  new URL(`../../shims/${moduleName}.ts`, import.meta.url).pathname;
