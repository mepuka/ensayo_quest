import { Context, Effect, Layer, Schedule } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { TurnEvaluation } from "../domain/RoomProtocol";
import { scoreFluency } from "../scoring/Fluency";
import { scoreRoleVocab } from "../scoring/Vocab";
import { LanguageReview } from "./LanguageReview";

export const ScoringWeights = Schema.Struct({
  fluency: Schema.Number,
  vocab: Schema.Number,
  naturalness: Schema.Number
});

export type ScoringWeights = Schema.Schema.Type<typeof ScoringWeights>;

export const ScoringConfigSchema = Schema.Struct({
  weights: ScoringWeights,
  modelVersion: Schema.String
});

export type ScoringConfigValue = Schema.Schema.Type<typeof ScoringConfigSchema>;

export class ScoringConfig extends Context.Tag("ScoringConfig")<
  ScoringConfig,
  ScoringConfigValue
>() {}

export const defaultScoringConfig: ScoringConfigValue = {
  weights: {
    fluency: 0.4,
    vocab: 0.3,
    naturalness: 0.3
  },
  modelVersion: "mvp"
};

export const ScoringConfigLive = Layer.succeed(ScoringConfig, defaultScoringConfig);

const AudioStatsSchema = Schema.Struct({
  totalMs: Schema.Number,
  speechMs: Schema.Number,
  silenceMs: Schema.Number,
  segments: Schema.Array(
    Schema.Struct({
      startMs: Schema.Number,
      endMs: Schema.Number
    })
  )
});

export const TurnScoringInput = Schema.Struct({
  turnId: Schema.String,
  transcript: Schema.String,
  audioStats: AudioStatsSchema,
  targetVocab: Schema.Array(Schema.String),
  targetGrammar: Schema.Array(Schema.String),
  objectives: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        description: Schema.String
      })
    )
  )
});

export type TurnScoringInput = Schema.Schema.Type<typeof TurnScoringInput>;

export class ScoringError extends Schema.TaggedError<ScoringError>()("ScoringError", {
  reason: Schema.String
}) {}

class LanguageReviewFailure extends Schema.TaggedError<LanguageReviewFailure>()(
  "LanguageReviewFailure",
  {
    failure: Schema.Literal("timeout", "failed"),
    reason: Schema.String
  }
) {}

export interface ScoringServiceApi {
  evaluateFinalWithFallback: (input: TurnScoringInput) => Effect.Effect<TurnEvaluation, ScoringError, never>;
  evaluatePartial: (input: TurnScoringInput) => Effect.Effect<TurnEvaluation, ScoringError, never>;
}

export class ScoringService extends Context.Tag("ScoringService")<
  ScoringService,
  ScoringServiceApi
>() {}

const scoreOverall = (weights: ScoringWeights, scores: ScoringWeights): number =>
  Math.round(
    weights.fluency * scores.fluency +
      weights.vocab * scores.vocab +
      weights.naturalness * scores.naturalness
  );

const scorePartialOverall = (weights: ScoringWeights, scores: ScoringWeights): number => {
  const total = weights.fluency + weights.vocab;
  if (total <= 0) {
    return 0;
  }
  return Math.round(
    (weights.fluency / total) * scores.fluency +
      (weights.vocab / total) * scores.vocab
  );
};

export const ScoringServiceLive = Layer.effect(
  ScoringService,
  Effect.gen(function* () {
    const config = yield* ScoringConfig;
    const evaluatePartial = Effect.fn("ScoringService.evaluatePartial")(function* (
      input: TurnScoringInput
    ) {
      const scores = {
        fluency: scoreFluency(input.audioStats, input.transcript),
        vocab: scoreRoleVocab(input.transcript, input.targetVocab),
        naturalness: 0
      };
      const overallScore = scorePartialOverall(config.weights, scores);
      return new TurnEvaluation({
        turnId: input.turnId,
        scores,
        overallScore,
        feedback: [],
        nextPrompt: "",
        modelVersion: config.modelVersion,
        confidence: 0,
        degraded: false
      });
    });

    const evaluateFinalWithFallback = Effect.fn("ScoringService.evaluateFinalWithFallback")(function* (
      input: TurnScoringInput
    ) {
      const reviewer = yield* Effect.serviceOption(LanguageReview);
      const reviewInput = {
        mode: "spoken" as const,
        language: "es",
        transcript: input.transcript,
        audioFeatures: {
          durationMs: input.audioStats.totalMs,
          pauseCount: input.audioStats.segments.length,
          speakingRateWpm: 0
        },
        targetVocab: input.targetVocab,
        targetGrammar: input.targetGrammar,
        objectives: input.objectives
      };

      const reviewEffect = Option.match(reviewer, {
        onNone: () =>
          Effect.fail(
            new LanguageReviewFailure({
              failure: "failed",
              reason: "language_review_unavailable"
            })
          ),
        onSome: (service) =>
          service.review(reviewInput).pipe(
            Effect.timeoutFail({
              duration: "2 seconds",
              onTimeout: () =>
                new LanguageReviewFailure({
                  failure: "timeout",
                  reason: "language_review_timeout"
                })
            })
          )
      }).pipe(
        Effect.mapError((cause) =>
          cause && typeof cause === "object" && "_tag" in cause && cause._tag === "LanguageReviewFailure"
            ? (cause as LanguageReviewFailure)
            : new LanguageReviewFailure({ failure: "failed", reason: String(cause) })
        )
      );

      const retrySchedule = Schedule.exponential("100 millis").pipe(
        Schedule.compose(Schedule.recurs(3)),
        Schedule.whileInput((error: LanguageReviewFailure) => error.failure !== "timeout")
      );

      const reviewResult = yield* Effect.either(
        reviewEffect.pipe(
          Effect.retry(retrySchedule),
          Effect.withSpan("scoring.llm")
        )
      );
      const localScores = {
        fluency: scoreFluency(input.audioStats, input.transcript),
        vocab: scoreRoleVocab(input.transcript, input.targetVocab),
        naturalness: 0
      };

      if (reviewResult._tag === "Right") {
        const reviewOutput = reviewResult.right;
        const scores = {
          ...localScores,
          naturalness: reviewOutput.subscores.naturalness
        };
        const overallScore = scoreOverall(config.weights, scores);
        return new TurnEvaluation({
          turnId: input.turnId,
          scores,
          overallScore,
          feedback: [...reviewOutput.feedback.wins, ...reviewOutput.feedback.fixes],
          nextPrompt: reviewOutput.nextPrompt,
          modelVersion: reviewOutput.modelVersion,
          confidence: reviewOutput.confidence,
          degraded: false
        });
      }

      const failure = reviewResult.left;
      const overallScore = scorePartialOverall(config.weights, localScores);
      return new TurnEvaluation({
        turnId: input.turnId,
        scores: localScores,
        overallScore,
        feedback: [],
        nextPrompt: "",
        modelVersion: config.modelVersion,
        confidence: 0,
        degraded: true,
        degradedReason:
          failure.failure === "timeout"
            ? "language_review_timeout"
            : "language_review_failed"
      });
    });
    return { evaluateFinalWithFallback, evaluatePartial };
  })
);
