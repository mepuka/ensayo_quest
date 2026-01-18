import { Context, Effect, Layer } from "effect";
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
  targetVocab: Schema.Array(Schema.String)
});

export type TurnScoringInput = Schema.Schema.Type<typeof TurnScoringInput>;

export class ScoringError extends Schema.TaggedError<ScoringError>()("ScoringError", {
  reason: Schema.String
}) {}

export interface ScoringServiceApi {
  evaluate: (input: TurnScoringInput) => Effect.Effect<TurnEvaluation, ScoringError, never>;
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
        confidence: 0
      });
    });

    const evaluate = Effect.fn("ScoringService.evaluate")(function* (input: TurnScoringInput) {
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
        targetVocab: input.targetVocab
      };
      const reviewResult = yield* Option.match(reviewer, {
        onNone: () => Effect.succeed(Option.none()),
        onSome: (service) =>
          service.review(reviewInput).pipe(
            Effect.map(Option.some),
            Effect.catchAll(() => Effect.succeed(Option.none()))
          )
      });
      const reviewOutput = Option.getOrUndefined(reviewResult);
      const scores = {
        fluency: scoreFluency(input.audioStats, input.transcript),
        vocab: scoreRoleVocab(input.transcript, input.targetVocab),
        naturalness: reviewOutput ? reviewOutput.subscores.naturalness : 0
      };
      const overallScore = scoreOverall(config.weights, scores);
      return new TurnEvaluation({
        turnId: input.turnId,
        scores,
        overallScore,
        feedback: reviewOutput
          ? [...reviewOutput.feedback.wins, ...reviewOutput.feedback.fixes]
          : [],
        nextPrompt: reviewOutput ? reviewOutput.nextPrompt : "",
        modelVersion: reviewOutput ? reviewOutput.modelVersion : config.modelVersion,
        confidence: reviewOutput ? reviewOutput.confidence : 0
      });
    });
    return { evaluate, evaluatePartial };
  })
);
