import { describe, expect, it } from "bun:test";
import { resolveAsrShimPath } from "../worker/workerBuild";

describe("resolveAsrShimPath", () => {
  it("returns shim paths for node modules", () => {
    expect(resolveAsrShimPath("fs")).toContain("/apps/web/shims/fs.ts");
    expect(resolveAsrShimPath("path")).toContain("/apps/web/shims/path.ts");
    expect(resolveAsrShimPath("url")).toContain("/apps/web/shims/url.ts");
  });
});
