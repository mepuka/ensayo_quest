import { it, expect } from "bun:test";
import { advance, AwaitingTurn, TurnSubmitted } from "../../domain/RoomState";
import { buildScoreUpdated, buildNpcPromptUpdated } from "../RoomEvents";

it("moves AwaitingTurn -> Evaluating on TurnSubmitted", () => {
  const next = advance(
    new AwaitingTurn({ _tag: "AwaitingTurn", userId: "u1" }),
    new TurnSubmitted({ _tag: "TurnSubmitted", turnId: "t1", userId: "u1" })
  );
  expect(next._tag).toBe("Evaluating");
});

it("exports RoomEvents helpers", () => {
  expect(buildScoreUpdated).toBeDefined();
});

it("builds score update payloads", () => {
  const payload = buildScoreUpdated({
    turnId: "t1",
    status: "partial"
  });
  expect(payload.event).toBe("ScoreUpdated");
  expect(payload.turnId).toBe("t1");
});

it("builds npc prompt update payloads", () => {
  const payload = buildNpcPromptUpdated({
    turnId: "t1",
    prompt: "Say hello"
  });
  expect(payload.event).toBe("NpcPromptUpdated");
  expect(payload.turnId).toBe("t1");
});
