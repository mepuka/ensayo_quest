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
