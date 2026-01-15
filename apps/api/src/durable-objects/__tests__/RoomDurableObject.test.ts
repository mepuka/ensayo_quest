import { it, expect } from "bun:test";
import { advance, AwaitingTurn, TurnSubmitted } from "../../domain/RoomState";
import { RoomDurableObject } from "../RoomDurableObject";

it("moves AwaitingTurn -> Evaluating on TurnSubmitted", () => {
  const next = advance(
    new AwaitingTurn({ _tag: "AwaitingTurn", userId: "u1" }),
    new TurnSubmitted({ _tag: "TurnSubmitted", turnId: "t1", userId: "u1" })
  );
  expect(next._tag).toBe("Evaluating");
});

it("exports RoomDurableObject", () => {
  expect(RoomDurableObject).toBeDefined();
});

it("builds score update payloads", () => {
  const payload = RoomDurableObject.buildScoreUpdated({
    turnId: "t1",
    status: "partial"
  });
  expect(payload.event).toBe("ScoreUpdated");
  expect(payload.turnId).toBe("t1");
});
