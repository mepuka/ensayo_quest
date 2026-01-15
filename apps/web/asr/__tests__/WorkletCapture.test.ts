import { it, expect } from "bun:test";
import { workletName } from "../worklet/WorkletCapture";

it("uses the expected worklet processor name", () => {
  expect(workletName).toBe("audio-processor");
});
