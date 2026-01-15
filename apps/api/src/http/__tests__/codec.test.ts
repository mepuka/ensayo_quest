import { it, expect } from "bun:test";
import { decodeJson, encodeJson } from "../codec";
import { HttpTurnSubmission } from "../../domain/HttpProtocol";

it("encodes and decodes JSON with schema", () => {
  const payload = new HttpTurnSubmission({
    roomId: "room-1",
    turnId: "turn-1",
    transcript: "hola",
    language: "es",
    clientTimestamp: 123,
    audioFeatures: {
      durationMs: 1000,
      pauseCount: 2,
      speakingRateWpm: 120
    }
  });
  const encoded = encodeJson(HttpTurnSubmission, payload);
  const decoded = decodeJson(HttpTurnSubmission, encoded);
  expect(decoded.turnId).toBe("turn-1");
});
