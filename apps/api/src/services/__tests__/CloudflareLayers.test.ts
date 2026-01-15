import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { D1Client } from "@effect/sql-d1";
import { SqliteClient } from "@effect/sql-sqlite-do";
import { Env } from "../Env";
import {
  AudioBucket,
  AudioBucketLive,
  D1ClientLive,
  makeDoSqliteLayer,
  VectorIndex,
  VectorIndexLive,
  WorkersAi,
  WorkersAiLive
} from "../CloudflareLayers";
import { TurnQueue, TurnQueueLive } from "../TurnQueue";

const fakeD1 = {
  prepare: () => ({
    bind: () => ({
      all: async () => ({ results: [], error: null })
    })
  })
} as unknown as D1Database;

const fakeQueue = {
  send: async () => {}
} as unknown as Queue;

const fakeR2 = {} as unknown as R2Bucket;
const fakeVector = {} as unknown as VectorizeIndex;
const fakeAi = {} as unknown as object;

const baseEnv = {
  DB: fakeD1,
  AUDIO_BUCKET: fakeR2,
  SPANISH_VECTORS: fakeVector,
  TURN_QUEUE: fakeQueue,
  ROOMS: {} as DurableObjectNamespace,
  AI: fakeAi
};

it("builds a D1 client layer from Env", async () => {
  const layer = Layer.provideMerge(Layer.succeed(Env, baseEnv))(D1ClientLive);
  const program = Effect.gen(function* () {
    const client = yield* D1Client.D1Client;
    return client.config.db;
  });
  const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
  expect(result).toBe(fakeD1);
});

it("builds a DO sqlite client layer from storage", async () => {
  const storage = {
    exec: () => ({
      columnNames: [],
      raw: function* () {}
    })
  } as unknown as SqlStorage;
  const layer = makeDoSqliteLayer(storage);
  const program = Effect.gen(function* () {
    const client = yield* SqliteClient.SqliteClient;
    return client.config.db;
  });
  const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
  expect(result).toBe(storage);
});

it("exposes R2 bucket binding via service", async () => {
  const layer = Layer.provideMerge(Layer.succeed(Env, baseEnv))(AudioBucketLive);
  const program = Effect.gen(function* () {
    const bucket = yield* AudioBucket;
    return bucket;
  });
  const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
  expect(result).toBe(fakeR2);
});

it("exposes Vectorize binding via service", async () => {
  const layer = Layer.provideMerge(Layer.succeed(Env, baseEnv))(VectorIndexLive);
  const program = Effect.gen(function* () {
    const index = yield* VectorIndex;
    return index;
  });
  const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
  expect(result).toBe(fakeVector);
});

it("exposes Workers AI binding via service", async () => {
  const layer = Layer.provideMerge(Layer.succeed(Env, baseEnv))(WorkersAiLive);
  const program = Effect.gen(function* () {
    const ai = yield* WorkersAi;
    return ai;
  });
  const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
  expect(result).toBe(fakeAi);
});

it("wraps queue binding for TurnQueue service", async () => {
  let sent = 0;
  const queue = {
    send: async () => {
      sent += 1;
    }
  } as unknown as Queue;
  const layer = Layer.provideMerge(
    Layer.succeed(Env, { ...baseEnv, TURN_QUEUE: queue })
  )(TurnQueueLive);
  const program = Effect.gen(function* () {
    const service = yield* TurnQueue;
    return yield* service.enqueueTurn({
      roomId: "r1",
      turnId: "t1",
      overall: 0,
      detailJson: "{}",
      status: "partial"
    });
  });
  await Effect.runPromise(program.pipe(Effect.provide(layer)));
  expect(sent).toBe(1);
});
