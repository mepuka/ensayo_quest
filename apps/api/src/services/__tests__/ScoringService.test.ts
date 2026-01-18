import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ScoringConfig,
  ScoringService,
  ScoringServiceLive
} from "../ScoringService";

it("computes overall score from configurable weights", async () => {
  const input = {
    turnId: "turn-1",
    transcript: "hola",
    audioStats: {
      totalMs: 1000,
      speechMs: 1000,
      silenceMs: 0,
      segments: []
    },
    targetVocab: ["adios"]
  };
  const configLayer = Layer.succeed(ScoringConfig, {
    weights: {
      fluency: 0.4,
      vocab: 0.3,
      naturalness: 0.3
    },
    modelVersion: "test-model"
  });
  const program = Effect.gen(function* () {
    const scoring = yield* ScoringService;
    return yield* scoring.evaluate(input);
  }).pipe(Effect.provide(ScoringServiceLive.pipe(Layer.provide(configLayer))));
  const evaluation = await Effect.runPromise(program);
  expect(evaluation.overallScore).toBe(40);
  expect(evaluation.modelVersion).toBe("test-model");
});

it("computes partial score by renormalizing fluency + vocab weights", async () => {
  const input = {
    turnId: "turn-2",
    transcript: "hola",
    audioStats: {
      totalMs: 1000,
      speechMs: 500,
      silenceMs: 500,
      segments: []
    },
    targetVocab: ["adios"]
  };
  const configLayer = Layer.succeed(ScoringConfig, {
    weights: {
      fluency: 0.4,
      vocab: 0.3,
      naturalness: 0.3
    },
    modelVersion: "test-model"
  });
  const program = Effect.gen(function* () {
    const scoring = yield* ScoringService;
    return yield* scoring.evaluatePartial(input);
  }).pipe(Effect.provide(ScoringServiceLive.pipe(Layer.provide(configLayer))));
  const evaluation = await Effect.runPromise(program);
  // Fluency: 60 + (0.5 * 40) = 80, Vocab: 0
  // Renormalized weights: 0.4/0.7 and 0.3/0.7 → overall ≈ 46
  expect(evaluation.overallScore).toBe(46);
  expect(evaluation.scores.naturalness).toBe(0);
  expect(evaluation.feedback).toEqual([]);
  expect(evaluation.nextPrompt).toBe("");
  expect(evaluation.confidence).toBe(0);
});
