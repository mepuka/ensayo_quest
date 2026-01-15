import { describe, expect, it } from "bun:test";
import { Effect, Stream, Chunk } from "effect";
import type { RoomEvent } from "../../shared/src/RoomProtocol";
import { initialScorePanelState, reduceRoomEvent } from "../eventlog/RoomEventReducer";
import { scorePanelStreamFromEvents } from "../eventlog/RoomEventAtoms";

describe("scorePanelStreamFromEvents", () => {
  it("reduces event streams into score panel states", async () => {
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

    const initial = initialScorePanelState("turn-0");
    const stream = scorePanelStreamFromEvents(Stream.make(...events), initial);
    const result = await Effect.runPromise(Stream.runCollect(stream));
    const states = Chunk.toReadonlyArray(result);

    expect(states.length).toBe(3);
    expect(states[0]).toEqual(initial);
    expect(states[1]!).toEqual(reduceRoomEvent(initial, events[0]!));
    expect(states[2]!).toEqual(reduceRoomEvent(states[1]!, events[1]!));
  });
});
