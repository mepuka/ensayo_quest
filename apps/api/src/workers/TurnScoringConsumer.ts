import { Context, Effect } from "effect";
import * as Schema from "effect/Schema";
import { decodeQueueJob } from "../domain/QueueJob";
import { Db } from "../services/Db";
import { RoomDoClient } from "../services/RoomDoClient";
import { ScoringService } from "../services/ScoringService";
import { ScoreUpdated, TurnEvaluation } from "../domain/RoomProtocol";

// Retryable error: transient failures that should be retried (network, DB timeouts)
export class TurnScoringRetryableError extends Schema.TaggedError<TurnScoringRetryableError>()(
  "TurnScoringRetryableError",
  { reason: Schema.String }
) {}

// Non-retryable error: permanent failures (validation, schema errors, missing data)
export class TurnScoringNonRetryableError extends Schema.TaggedError<TurnScoringNonRetryableError>()(
  "TurnScoringNonRetryableError",
  { reason: Schema.String }
) {}

// Union type for all scoring errors
export type TurnScoringError = TurnScoringRetryableError | TurnScoringNonRetryableError;

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
  const handle = Effect.fn("TurnScoringConsumer.handle")(function* (payload: unknown) {
      // Decode errors are non-retryable - invalid payload won't become valid
      const job = yield* Effect.try({
        try: () => decodeQueueJob(payload),
        catch: (cause) => new TurnScoringNonRetryableError({ reason: `Invalid payload: ${cause}` })
      });

      // Defense in depth: Verify AudioUploaded exists before scoring
      // @see docs/ARCHITECTURE.md - Invariant #9: Scoring gated on AudioUploaded
      // This handles edge cases where queue job exists but audio wasn't uploaded
      const audioUpload = yield* db.getAudioUploadByTurnId(job.turnId).pipe(
        Effect.mapError((cause) => new TurnScoringRetryableError({ reason: String(cause) }))
      );

      if (!audioUpload) {
        // No audio upload found - ACK message to prevent infinite retry
        // This can happen if:
        // 1. Effect.fork in AudioUploaded handler failed after idempotency record
        // 2. Manual queue re-enqueue without corresponding audio upload
        yield* Effect.logWarning(
          `Skipping scoring for turn ${job.turnId}: AudioUploaded not found (defense in depth)`
        );
        return;
      }

      // Not found errors are non-retryable - data won't appear on retry
      const submission = yield* db.getTurnSubmission(job.turnId).pipe(
        Effect.mapError((cause) => {
          const reason = String(cause);
          if (reason.includes("not_found")) {
            return new TurnScoringNonRetryableError({ reason });
          }
          return new TurnScoringRetryableError({ reason });
        })
      );
      const templateRecord = yield* db.getScenarioTemplate(submission.templateId).pipe(
        Effect.mapError((cause) => {
          const reason = String(cause);
          if (reason.includes("not_found")) {
            return new TurnScoringNonRetryableError({ reason });
          }
          return new TurnScoringRetryableError({ reason });
        })
      );
      const scoreAttemptId = crypto.randomUUID();
      const targetVocab = templateRecord.template.roleRubrics[0]?.targetVocab ?? [];
      // Scoring service errors are typically retryable (external API issues)
      const evaluation = yield* scoring.evaluate({
        turnId: submission.turnId,
        transcript: submission.transcript,
        audioStats: submission.audioStats,
        targetVocab
      }).pipe(
        Effect.mapError((cause) => new TurnScoringRetryableError({ reason: String(cause) }))
      );
      // Schema encoding errors are non-retryable - bad data structure
      const detailJson = yield* Effect.try({
        try: () => Schema.encodeSync(Schema.parseJson(TurnEvaluation))(evaluation),
        catch: (cause) => new TurnScoringNonRetryableError({ reason: `Encoding error: ${cause}` })
      });
      // DB write errors are retryable
      yield* db.updateTurnScore({
        turnId: job.turnId,
        overall: evaluation.overallScore,
        detailJson
      }).pipe(
        Effect.mapError((cause) =>
          new TurnScoringRetryableError({
            reason: cause instanceof Error ? cause.message : String(cause)
          })
        )
      );
      // DO event emission errors are retryable
      yield* roomDo.emitRoomEvent(
        job.roomId,
        new ScoreUpdated({
          type: "ScoreUpdated",
          turnId: job.turnId,
          status: "final",
          scoreAttemptId,
          evaluation
        })
      ).pipe(
        Effect.mapError((cause) => new TurnScoringRetryableError({ reason: String(cause) }))
      );
    });

  return { handle };
});
