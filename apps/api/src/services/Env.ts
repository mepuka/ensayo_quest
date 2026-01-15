import { Context } from "effect";

export interface CloudflareEnv {
  DB: D1Database;
  AUDIO_BUCKET: R2Bucket;
  SPANISH_VECTORS: VectorizeIndex;
  TURN_QUEUE: Queue;
  ROOMS: DurableObjectNamespace;
  AI: any; // Workers AI binding
}

export class Env extends Context.Tag("Env")<Env, CloudflareEnv>() {}
