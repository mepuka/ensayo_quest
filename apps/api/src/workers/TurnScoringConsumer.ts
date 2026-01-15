import { Context, Effect } from "effect";
import * as Schema from "effect/Schema";
import { decodeQueueJob } from "../domain/QueueJob";
import { Db } from "../services/Db";
import { RoomDoClient } from "../services/RoomDoClient";
import { ScoringService } from "../services/ScoringService";
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
  const scoring = yield* ScoringService;
  const handle = Effect.fn(function* (payload: unknown) {
      const job = yield* Effect.try({
        try: () => decodeQueueJob(payload),
        catch: (cause) => new TurnScoringError({ reason: String(cause) })
      });
      const submission = yield* db.getTurnSubmission(job.turnId).pipe(
        Effect.mapError((cause) => new TurnScoringError({ reason: String(cause) }))
      );
      const template = yield* db.getScenarioTemplate(submission.templateId).pipe(
        Effect.mapError((cause) => new TurnScoringError({ reason: String(cause) }))
      );
      const targetVocab = template.roleRubrics[0]?.targetVocab ?? [];
      const evaluation = yield* scoring.evaluate({
        turnId: submission.turnId,
        transcript: submission.transcript,
        audioStats: submission.audioStats,
        targetVocab
      }).pipe(
        Effect.mapError((cause) => new TurnScoringError({ reason: String(cause) }))
      );
      const detailJson = yield* Effect.try({
        try: () => Schema.encodeSync(Schema.parseJson(TurnEvaluation))(evaluation),
        catch: (cause) => new TurnScoringError({ reason: String(cause) })
      });
      yield* db.updateTurnScore({
        turnId: job.turnId,
        overall: evaluation.overallScore,
        detailJson
      }).pipe(
        Effect.mapError((cause) =>
          new TurnScoringError({
            reason: cause instanceof Error ? cause.message : String(cause)
          })
        )
      );
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
