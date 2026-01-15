import { Context, Effect } from "effect";
import * as Schema from "effect/Schema";
import { decodeQueueJob } from "../domain/QueueJob";
import { Db } from "../services/Db";

export class TurnScoringError extends Schema.TaggedError<TurnScoringError>()("TurnScoringError", {
  reason: Schema.String
}) {}

export interface TurnScoringConsumerService {
  handle: (payload: unknown) => Effect.Effect<void, TurnScoringError, never>;
}

export class TurnScoringConsumer extends Context.Tag("TurnScoringConsumer")<
  TurnScoringConsumer,
  TurnScoringConsumerService
>() {}

export const makeTurnScoringConsumer = Effect.gen(function* () {
  const db = yield* Db;
  const handle = Effect.fn(function* (payload: unknown) {
      const job = yield* Effect.try({
        try: () => decodeQueueJob(payload),
        catch: (cause) => new TurnScoringError({ reason: String(cause) })
      });
      yield* db.updateTurnScore({
        turnId: job.turnId,
        overall: job.overall,
        detailJson: job.detailJson
      }).pipe(
        Effect.mapError((cause) =>
          new TurnScoringError({
            reason: cause instanceof Error ? cause.message : String(cause)
          })
        )
      );
    });

  return { handle };
});
