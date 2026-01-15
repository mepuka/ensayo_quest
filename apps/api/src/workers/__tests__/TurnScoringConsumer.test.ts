import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { makeTurnScoringConsumer } from "../TurnScoringConsumer";
import { Db } from "../../services/Db";

it("updates turn score from queue job payload", async () => {
  let updated: unknown = null;
  const dbLayer = Layer.succeed(Db, {
    createRoom: () => Effect.void,
    insertTurn: () => Effect.void,
    updateTurnScore: (input) =>
      Effect.sync(() => {
        updated = input;
      })
  });
  const consumer = await Effect.runPromise(
    makeTurnScoringConsumer.pipe(Effect.provide(dbLayer))
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
});
