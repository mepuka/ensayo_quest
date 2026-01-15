import { it, expect } from "bun:test";
import { buildTranscribeRequest } from "../worker/WorkerClient";

it("builds a transcribe request payload", () => {
  const request = buildTranscribeRequest(new Float32Array([0, 1]), 16000);
  expect(request.type).toBe("transcribe");
  expect(request.sampleRate).toBe(16000);
});
