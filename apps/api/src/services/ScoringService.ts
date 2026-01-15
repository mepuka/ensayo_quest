import { Context, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { TurnEvaluation } from "../domain/RoomProtocol";
import { scoreFluency } from "../scoring/Fluency";
import { scoreRoleVocab } from "../scoring/Vocab";

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

export interface ScoringService {
  evaluate: (input: TurnScoringInput) => Effect.Effect<TurnEvaluation, ScoringError, never>;
}

export class ScoringService extends Context.Tag("ScoringService")<
  ScoringService,
  ScoringService
>() {}

const scoreOverall = (weights: ScoringWeights, scores: ScoringWeights): number =>
  Math.round(
    weights.fluency * scores.fluency +
      weights.vocab * scores.vocab +
      weights.naturalness * scores.naturalness
  );

export const ScoringServiceLive = Layer.effect(
  ScoringService,
  Effect.gen(function* () {
    const config = yield* ScoringConfig;
    const evaluate = Effect.fn(function* (input: TurnScoringInput) {
      const scores = {
        fluency: scoreFluency(input.audioStats, input.transcript),
        vocab: scoreRoleVocab(input.transcript, input.targetVocab),
        naturalness: 0
      };
      const overallScore = scoreOverall(config.weights, scores);
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
    return { evaluate };
  })
);
