import { Context, Effect, Layer } from "effect";
import * as Config from "effect/Config";
import { Reactivity } from "@effect/experimental";
import { D1Client } from "@effect/sql-d1";
import { SqliteClient } from "@effect/sql-sqlite-do";
import type { CloudflareEnv } from "./Env";
import { Env } from "./Env";
import type { SqlStorage } from "@cloudflare/workers-types";

export class AudioBucket extends Context.Tag("AudioBucket")<AudioBucket, R2Bucket>() {}

export class VectorIndex extends Context.Tag("VectorIndex")<VectorIndex, VectorizeIndex>() {}

export class WorkersAi extends Context.Tag("WorkersAi")<
  WorkersAi,
  CloudflareEnv["AI"]
>() {}

export const D1ClientLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const env = yield* Env;
    return D1Client.layerConfig(Config.succeed({ db: env.DB }));
  })
).pipe(Layer.provide(Reactivity.layer));

export const makeDoSqliteLayer = (db: SqlStorage) =>
  SqliteClient.layerConfig(Config.succeed({ db })).pipe(Layer.provide(Reactivity.layer));

export const AudioBucketLive = Layer.effect(
  AudioBucket,
  Effect.gen(function* () {
    const env = yield* Env;
    return env.AUDIO_BUCKET;
  })
);

export const VectorIndexLive = Layer.effect(
  VectorIndex,
  Effect.gen(function* () {
    const env = yield* Env;
    return env.SPANISH_VECTORS;
  })
);

export const WorkersAiLive = Layer.effect(
  WorkersAi,
  Effect.gen(function* () {
    const env = yield* Env;
    return env.AI;
  })
);
