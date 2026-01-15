import { describe, expect, it } from "bun:test";
import type { RoomEvent } from "../../shared/src/RoomProtocol";
import { reduceRoomEvent, initialScorePanelState } from "../eventlog/RoomEventReducer";

const baseEvaluation = {
  turnId: "turn-1",
  scores: {
    fluency: 0.7,
    vocab: 0.6,
    naturalness: 0.8
  },
  overallScore: 0.7,
  feedback: ["Good flow"],
  nextPrompt: "Continue the conversation.",
  modelVersion: "test-model",
  confidence: 0.9
};

describe("reduceRoomEvent", () => {
  it("updates overall and status for ScoreUpdated", () => {
    const event: RoomEvent = {
      type: "ScoreUpdated",
      turnId: "turn-1",
      evaluation: baseEvaluation
    };
    const next = reduceRoomEvent(initialScorePanelState("turn-0"), event);

    expect(next.turnId).toBe("turn-1");
    expect(next.status).toBe("final");
    expect(next.overall).toBe(0.7);
    expect(next.npcPrompt).toBe("Continue the conversation.");
  });

  it("updates turn id and status for TurnAccepted", () => {
    const event: RoomEvent = {
      type: "TurnAccepted",
      turnId: "turn-2"
    };
    const next = reduceRoomEvent(initialScorePanelState("turn-0"), event);

    expect(next.turnId).toBe("turn-2");
    expect(next.status).toBe("pending");
    expect(next.overall).toBeNull();
  });

  it("ignores unrelated events", () => {
    const event: RoomEvent = {
      type: "RoomCompleted",
      summary: "All done"
    };
    const state = initialScorePanelState("turn-3");
    const next = reduceRoomEvent(state, event);

    expect(next).toEqual(state);
  });
});
