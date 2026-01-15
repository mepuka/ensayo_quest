import { Context, Effect } from "effect";
import * as Schema from "effect/Schema";
import { decodeQueueJob } from "../domain/QueueJob";
import { Db } from "../services/Db";
import { RoomDoClient } from "../services/RoomDoClient";
import { ScoreUpdated, TurnEvaluation } from "../domain/RoomProtocol";

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
  const roomDo = yield* RoomDoClient;
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
      const parsedDetail = yield* Effect.try({
        try: () => JSON.parse(job.detailJson) as Record<string, unknown>,
        catch: (cause) => new TurnScoringError({ reason: String(cause) })
      });
      const subscores = parsedDetail.subscores as Record<string, number> | undefined;
      const evaluation = new TurnEvaluation({
        turnId: job.turnId,
        scores: {
          fluency: subscores?.fluency ?? 0,
          vocab: subscores?.vocab ?? 0,
          naturalness: subscores?.naturalness ?? 0
        },
        overallScore: job.overall,
        feedback: (parsedDetail.feedback as Array<string> | undefined) ?? [],
        nextPrompt: (parsedDetail.nextPrompt as string | undefined) ?? "",
        modelVersion: (parsedDetail.modelVersion as string | undefined) ?? "unknown",
        confidence: (parsedDetail.confidence as number | undefined) ?? 0
      });
      yield* roomDo.emitRoomEvent(
        job.roomId,
        new ScoreUpdated({
          type: "ScoreUpdated",
          turnId: job.turnId,
          evaluation
        })
      );
    });

  return { handle };
});
