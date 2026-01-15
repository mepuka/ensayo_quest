import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { Db, DbLive } from "../Db";
import { Env } from "../Env";
import { queries } from "../../db/queries";

it("writes room and turn records via D1 binding", async () => {
  const calls: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
  const fakeDb = {
    prepare: (sql: string) => ({
      bind: (...params: ReadonlyArray<unknown>) => ({
        run: async () => {
          calls.push({ sql, params });
          return { success: true };
        }
      })
    })
  } as unknown as D1Database;
  const envLayer = Layer.succeed(Env, {
    DB: fakeDb,
    AUDIO_BUCKET: {} as R2Bucket,
    SPANISH_VECTORS: {} as VectorizeIndex,
    TURN_QUEUE: {} as Queue,
    ROOMS: {} as DurableObjectNamespace,
    AI: {}
  });
  const program = Effect.gen(function* () {
    const db = yield* Db;
    yield* db.createRoom("room-1", "template-1");
    yield* db.insertTurn({
      roomId: "room-1",
      turnId: "turn-1",
      templateId: "tmp",
      turnIndex: 0,
      speakerUserId: "user-1",
      transcript: "hola",
      audioStats: { totalMs: 10, speechMs: 8, silenceMs: 2, segments: [] }
    });
  });
  await Effect.runPromise(program.pipe(Effect.provide(Layer.provideMerge(envLayer)(DbLive))));
  expect(calls[0]?.sql).toBe(queries.insertRoom);
  expect(calls[0]?.params[0]).toBe("room-1");
  expect(calls[0]?.params[1]).toBe("template-1");
  expect(calls[1]?.sql).toBe(queries.insertTurn);
  expect(calls[1]?.params[0]).toBe("turn-1");
  expect(calls[1]?.params[2]).toBe("tmp");
  expect(calls[1]?.params[3]).toBe(0);
});

it("writes turn score updates via D1 binding", async () => {
  const calls: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
  const fakeDb = {
    prepare: (sql: string) => ({
      bind: (...params: ReadonlyArray<unknown>) => ({
        run: async () => {
          calls.push({ sql, params });
          return { success: true };
        }
      })
    })
  } as unknown as D1Database;
  const envLayer = Layer.succeed(Env, {
    DB: fakeDb,
    AUDIO_BUCKET: {} as R2Bucket,
    SPANISH_VECTORS: {} as VectorizeIndex,
    TURN_QUEUE: {} as Queue,
    ROOMS: {} as DurableObjectNamespace,
    AI: {}
  });
  const program = Effect.gen(function* () {
    const db = yield* Db;
    yield* db.updateTurnScore({
      turnId: "turn-9",
      overall: 88,
      detailJson: JSON.stringify({ subscores: { fluency: 80 } })
    });
  });
  await Effect.runPromise(program.pipe(Effect.provide(Layer.provideMerge(envLayer)(DbLive))));
  expect(calls[0]?.sql).toBe(queries.updateTurnScore);
  expect(queries.updateTurnScore).toContain("ON CONFLICT");
  expect(calls[0]?.params[0]).toBe("turn-9");
});
