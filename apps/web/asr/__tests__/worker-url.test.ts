import { describe, expect, it } from "bun:test";
import { buildAsrWorkerUrl } from "../LocalAsr";

describe("buildAsrWorkerUrl", () => {
  it("builds a worker URL from base URL", () => {
    const url = buildAsrWorkerUrl("http://localhost:3000/app");
    expect(url).toBe("http://localhost:3000/asrWorker.js");
  });
});
