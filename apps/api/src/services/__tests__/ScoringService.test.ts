import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ScoringConfig,
  ScoringService,
  ScoringServiceLive
} from "../ScoringService";
import { LanguageReview } from "../LanguageReview";

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
    targetVocab: ["adios"],
    targetGrammar: []
  };
  const reviewLayer = Layer.succeed(LanguageReview, {
    review: () =>
      Effect.succeed({
        subscores: {
          fluency: 0,
          vocab: 0,
          grammar: 0,
          relevance: 0,
          pronunciation: 0,
          naturalness: 0
        },
        feedback: {
          wins: [],
          fixes: []
        },
        correctedPhrases: [],
        nextPrompt: "",
        confidence: 1,
        modelVersion: "mock"
      })
  });
  const configLayer = Layer.succeed(ScoringConfig, {
    weights: {
      fluency: 0.4,
      vocab: 0.3,
      naturalness: 0.3
    },
    modelVersion: "test-model"
  });
  const scoringLayer = ScoringServiceLive.pipe(Layer.provide(configLayer));
  const fullLayer = Layer.mergeAll(scoringLayer, reviewLayer);
  const program = Effect.gen(function* () {
    const scoring = yield* ScoringService;
    return yield* scoring.evaluateFinalWithFallback(input);
  }).pipe(Effect.provide(fullLayer));
  const evaluation = await Effect.runPromise(program);
  expect(evaluation.overallScore).toBe(40);
  expect(evaluation.modelVersion).toBe("mock");
  expect(evaluation.degraded).toBe(false);
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
    targetVocab: ["adios"],
    targetGrammar: []
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
  expect(evaluation.degraded).toBe(false);
});

it("marks final evaluation as degraded when LanguageReview fails", async () => {
  const input = {
    turnId: "turn-3",
    transcript: "hola",
    audioStats: {
      totalMs: 1000,
      speechMs: 1000,
      silenceMs: 0,
      segments: []
    },
    targetVocab: ["adios"],
    targetGrammar: []
  };
  const configLayer = Layer.succeed(ScoringConfig, {
    weights: {
      fluency: 0.4,
      vocab: 0.3,
      naturalness: 0.3
    },
    modelVersion: "test-model"
  });
  const reviewLayer = Layer.succeed(LanguageReview, {
    review: () => Effect.fail(new Error("boom"))
  });
  const scoringLayer = ScoringServiceLive.pipe(Layer.provide(configLayer));
  const fullLayer = Layer.mergeAll(scoringLayer, reviewLayer);
  const program = Effect.gen(function* () {
    const scoring = yield* ScoringService;
    return yield* scoring.evaluateFinalWithFallback(input);
  }).pipe(Effect.provide(fullLayer));
  const evaluation = await Effect.runPromise(program);
  expect(evaluation.degraded).toBe(true);
  expect(evaluation.degradedReason).toBe("language_review_failed");
  expect(evaluation.scores.naturalness).toBe(0);
});

it("marks final evaluation as degraded on LanguageReview timeout", async () => {
  const input = {
    turnId: "turn-4",
    transcript: "hola",
    audioStats: {
      totalMs: 1000,
      speechMs: 1000,
      silenceMs: 0,
      segments: []
    },
    targetVocab: ["adios"],
    targetGrammar: []
  };
  const configLayer = Layer.succeed(ScoringConfig, {
    weights: {
      fluency: 0.4,
      vocab: 0.3,
      naturalness: 0.3
    },
    modelVersion: "test-model"
  });
  const reviewLayer = Layer.succeed(LanguageReview, {
    review: () =>
      Effect.sleep("3 seconds").pipe(
        Effect.as({
          subscores: {
            fluency: 0,
            vocab: 0,
            grammar: 0,
            relevance: 0,
            pronunciation: 0,
            naturalness: 100
          },
          feedback: { wins: [], fixes: [] },
          correctedPhrases: [],
          nextPrompt: "",
          confidence: 1,
          modelVersion: "mock"
        })
      )
  });
  const scoringLayer = ScoringServiceLive.pipe(Layer.provide(configLayer));
  const fullLayer = Layer.mergeAll(scoringLayer, reviewLayer);
  const program = Effect.gen(function* () {
    const scoring = yield* ScoringService;
    return yield* scoring.evaluateFinalWithFallback(input);
  }).pipe(Effect.provide(fullLayer));
  const evaluation = await Effect.runPromise(program);
  expect(evaluation.degraded).toBe(true);
  expect(evaluation.degradedReason).toBe("language_review_timeout");
  expect(evaluation.scores.naturalness).toBe(0);
});
