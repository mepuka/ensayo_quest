import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { makeTurnScoringConsumer } from "../TurnScoringConsumer";
import { Db } from "../../services/Db";
import { RoomDoClient } from "../../services/RoomDoClient";

it("updates turn score from queue job payload", async () => {
  let updated: unknown = null;
  let emitted: Array<string> = [];
  const dbLayer = Layer.succeed(Db, {
    createRoom: () => Effect.void,
    insertTurn: () => Effect.void,
    updateTurnScore: (input) =>
      Effect.sync(() => {
        updated = input;
      })
  });
  const doLayer = Layer.succeed(RoomDoClient, {
    emitRoomEvent: (_roomId, event) =>
      Effect.sync(() => {
        emitted.push(event.type);
      })
  });
  const consumer = await Effect.runPromise(
    makeTurnScoringConsumer.pipe(Effect.provide(Layer.mergeAll(dbLayer, doLayer)))
  );
  await Effect.runPromise(
    consumer.handle({
      roomId: "r1",
      turnId: "t1",
      overall: 77,
      detailJson: JSON.stringify({ subscores: { vocab: 70 } }),
      status: "final"
    })
  );
  if (!updated) {
    throw new Error("expected updateTurnScore to be called");
  }
  const ensured = updated as { turnId: string; overall: number; detailJson: string };
  expect(ensured.turnId).toBe("t1");
  expect(ensured.overall).toBe(77);
  expect(emitted).toEqual(["ScoreUpdated"]);
});
