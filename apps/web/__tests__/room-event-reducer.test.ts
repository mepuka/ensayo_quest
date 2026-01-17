import { describe, expect, it } from "bun:test";
import type { RoomEvent } from "../../shared/src/RoomProtocol";
import { reduceRoomEvent, initialRoomState } from "../eventlog/RoomEventReducer";

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
  it("updates turn state for ScoreUpdated", () => {
    const event: RoomEvent = {
      type: "ScoreUpdated",
      turnId: "turn-1",
      evaluation: baseEvaluation
    };
    const next = reduceRoomEvent(initialRoomState, event);

    expect(next.turn.turnId).toBe("turn-1");
    expect(next.turn.scoringStatus).toBe("scored");
    expect(next.turn.evaluation?.overallScore).toBe(0.7);
    expect(next.turn.evaluation?.nextPrompt).toBe("Continue the conversation.");
  });

  it("updates turn state for TurnAccepted", () => {
    const event: RoomEvent = {
      type: "TurnAccepted",
      turnId: "turn-2",
      roomId: "room-1",
      playerId: "user",
      transcript: "Hello",
      timestamp: Date.now()
    };
    const next = reduceRoomEvent(initialRoomState, event);

    expect(next.turn.turnId).toBe("turn-2");
    expect(next.turn.scoringStatus).toBe("pending");
    expect(next.turn.evaluation).toBeNull();
  });

  it("handles RoomSnapshot", () => {
    const event: RoomEvent = {
      type: "RoomSnapshot",
      roomId: "room-1",
      scenarioId: "scenario-1",
      status: "playing",
      currentTurnIndex: 3,
      objectivesCompleted: 2,
      history: [
        { turnId: "turn-1", role: "user", text: "Hello" },
        { turnId: "turn-2", role: "npc", text: "Hi there" }
      ]
    };
    const next = reduceRoomEvent(initialRoomState, event);

    expect(next.roomId).toBe("room-1");
    expect(next.scenarioId).toBe("scenario-1");
    expect(next.status).toBe("playing");
    expect(next.currentTurnIndex).toBe(3);
    expect(next.objectivesCompleted).toBe(2);
    expect(next.history).toHaveLength(2);
  });

  it("handles RoomCompleted", () => {
    const event: RoomEvent = {
      type: "RoomCompleted",
      summary: "All done"
    };
    const next = reduceRoomEvent(initialRoomState, event);

    expect(next.status).toBe("completed");
    expect(next.completionSummary).toBe("All done");
  });

  it("handles RoomError", () => {
    const event: RoomEvent = {
      type: "Error",
      code: "E001",
      message: "Something went wrong",
      retryable: true
    };
    const next = reduceRoomEvent(initialRoomState, event);

    expect(next.status).toBe("error");
    expect(next.error?.code).toBe("E001");
    expect(next.error?.message).toBe("Something went wrong");
    expect(next.error?.retryable).toBe(true);
  });
});
