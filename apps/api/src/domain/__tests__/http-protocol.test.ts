import { it, expect } from "bun:test";
import { decodeHttpTurnSubmission } from "../HttpProtocol";

it("decodes HTTP TurnSubmission payloads", () => {
  const decoded = decodeHttpTurnSubmission({
    roomId: "room-1",
    turnId: "turn-1",
    transcript: "hola",
    language: "es",
    clientTimestamp: 123,
    audioFeatures: {
      durationMs: 1000,
      pauseCount: 2,
      speakingRateWpm: 120
    },
    audioKey: "room-1/turn-1",
    asrSource: "local"
  });
  expect(decoded.turnId).toBe("turn-1");
  expect(decoded.audioFeatures.durationMs).toBe(1000);
});
