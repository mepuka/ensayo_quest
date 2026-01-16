import { describe, expect, it } from "bun:test";
import { Effect, Stream, Chunk } from "effect";
import type { RoomEvent } from "../../shared/src/RoomProtocol";
import { initialRoomState, reduceRoomEvent } from "../eventlog/RoomEventReducer";
import { roomStateStreamFromEvents } from "../eventlog/RoomEventAtoms";

describe("roomStateStreamFromEvents", () => {
  it("reduces event streams into room states", async () => {
    const events: Array<RoomEvent> = [
      { type: "TurnAccepted", turnId: "turn-1" },
      {
        type: "ScoreUpdated",
        turnId: "turn-1",
        evaluation: {
          turnId: "turn-1",
          scores: { fluency: 0.7, vocab: 0.6, naturalness: 0.8 },
          overallScore: 0.7,
          feedback: ["Good flow"],
          nextPrompt: "Continue the conversation.",
          modelVersion: "test-model",
          confidence: 0.9
        }
      }
    ];

    const stream = roomStateStreamFromEvents(Stream.make(...events), initialRoomState);
    const result = await Effect.runPromise(Stream.runCollect(stream));
    const states = Chunk.toReadonlyArray(result);

    expect(states.length).toBe(3);
    expect(states[0]).toEqual(initialRoomState);
    expect(states[1]).toEqual(reduceRoomEvent(initialRoomState, events[0]!));
    expect(states[2]).toEqual(reduceRoomEvent(states[1]!, events[1]!));
  });

  it("handles all event types in sequence", async () => {
    const events: Array<RoomEvent> = [
      {
        type: "RoomSnapshot",
        roomId: "room-1",
        scenarioId: "scenario-1",
        status: "playing",
        currentTurnIndex: 0,
        objectivesCompleted: 0,
        history: []
      },
      { type: "TurnAccepted", turnId: "turn-1" },
      {
        type: "ScoreUpdated",
        turnId: "turn-1",
        evaluation: {
          turnId: "turn-1",
          scores: { fluency: 0.7, vocab: 0.6, naturalness: 0.8 },
          overallScore: 0.7,
          feedback: ["Good flow"],
          nextPrompt: "Continue the conversation.",
          modelVersion: "test-model",
          confidence: 0.9
        }
      },
      { type: "RoomCompleted", summary: "Session complete" }
    ];

    const stream = roomStateStreamFromEvents(Stream.make(...events), initialRoomState);
    const result = await Effect.runPromise(Stream.runCollect(stream));
    const states = Chunk.toReadonlyArray(result);

    expect(states.length).toBe(5);

    // Initial state
    expect(states[0]!.status).toBe("connecting");

    // After RoomSnapshot
    expect(states[1]!.status).toBe("playing");
    expect(states[1]!.roomId).toBe("room-1");

    // After TurnAccepted
    expect(states[2]!.turn.turnId).toBe("turn-1");
    expect(states[2]!.turn.scoringStatus).toBe("pending");

    // After ScoreUpdated
    expect(states[3]!.turn.scoringStatus).toBe("scored");
    expect(states[3]!.turn.evaluation?.overallScore).toBe(0.7);

    // After RoomCompleted
    expect(states[4]!.status).toBe("completed");
    expect(states[4]!.completionSummary).toBe("Session complete");
  });
});
