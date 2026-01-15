import { Context, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { Env } from "./Env";

export class QueueError extends Schema.TaggedError<QueueError>()("QueueError", {
  reason: Schema.String
}) {}

export type TurnJob = {
  roomId: string;
  turnId: string;
  status: "partial" | "final";
};

export interface TurnQueueService {
  enqueueTurn: (job: TurnJob) => Effect.Effect<void, QueueError, never>;
}

export class TurnQueue extends Context.Tag("TurnQueue")<TurnQueue, TurnQueueService>() {}

export const TurnQueueLive = Layer.effect(
  TurnQueue,
  Effect.gen(function* () {
    const env = yield* Env;
    return {
      enqueueTurn: (job: TurnJob) =>
        Effect.tryPromise({
          try: () => env.TURN_QUEUE.send(job),
          catch: (cause) => new QueueError({ reason: String(cause) })
        })
    };
  })
);
