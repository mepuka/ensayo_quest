import { describe, expect, it } from "bun:test";
import { buildWorkletUrl } from "../worklet/WorkletCapture";

describe("buildWorkletUrl", () => {
  it("builds a worklet URL from base URL", () => {
    const url = buildWorkletUrl("http://localhost:3000/app");
    expect(url).toBe("http://localhost:3000/workers/audioProcessor.js");
  });
});
