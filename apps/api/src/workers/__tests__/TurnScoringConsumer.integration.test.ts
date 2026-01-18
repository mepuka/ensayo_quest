/**
 * Integration test for TurnScoringConsumer with mock scoring mode.
 *
 * Tests the full scoring pipeline using LANGUAGE_REVIEW_MODE=mock:
 * - Real ScoringServiceLive
 * - Mock LanguageReview via LanguageReviewConfigurable
 * - Verifies mock responses flow through correctly
 *
 * @see services/LanguageReviewFactory.ts for mock implementation details
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { makeTurnScoringConsumer } from "../TurnScoringConsumer";
import { Db } from "../../services/Db";
import { ScoringServiceLive, ScoringConfigLive } from "../../services/ScoringService";
import { RoomDoClient } from "../../services/RoomDoClient";
import { Env, type CloudflareEnv } from "../../services/Env";
import { LanguageReviewConfigurable } from "../../services/LanguageReviewFactory";
import { LanguageReview } from "../../services/LanguageReview";
import { TurnEvaluation } from "../../domain/RoomProtocol";

/**
 * Create a mock CloudflareEnv with LANGUAGE_REVIEW_MODE set.
 */
const makeMockEnv = (mode: "mock" | "disabled" | "google"): CloudflareEnv =>
  ({
    DB: {} as D1Database,
    AUDIO_BUCKET: {} as R2Bucket,
    SPANISH_VECTORS: {} as VectorizeIndex,
    TURN_QUEUE: {} as Queue,
    ROOMS: {} as DurableObjectNamespace,
    LANGUAGE_REVIEW_MODE: mode
  }) as CloudflareEnv;

/**
 * Create a mock Db layer for testing.
 */
const makeDbLayer = (options?: {
  onUpdateTurnScore?: (input: unknown) => void;
  audioUploadExists?: boolean;
}) =>
  Layer.succeed(Db, {
    createRoom: () => Effect.void,
    insertTurn: () => Effect.void,
    updateTurnScore: (input) =>
      Effect.sync(() => {
        options?.onUpdateTurnScore?.(input);
      }),
    updateTurnAudioKey: () => Effect.void,
    getRoomTemplateId: () => Effect.succeed("template-1"),
    getNextTurnIndex: () => Effect.succeed(0),
    findScenarioTemplate: () =>
      Effect.succeed({
        template: {
          templateId: "template-1",
          topic: "travel",
          level: "A2",
          seedPrompt: "Hola, ¿cómo estás?",
          turnPlan: [],
          roleRubrics: [
            {
              roleId: "user",
              targetVocab: ["hola", "gracias", "buenos días"],
              targetGrammar: []
            }
          ]
        },
        templateVersion: "tpl-version-1"
      }),
    getTurnSubmission: () =>
      Effect.succeed({
        roomId: "room-integration-test",
        turnId: "turn-integration-test",
        templateId: "template-1",
        turnIndex: 0,
        speakerUserId: "user-1",
        transcript: "Hola, me llamo Carlos. Estoy muy bien, gracias.",
        audioStats: {
          totalMs: 3500,
          speechMs: 3000,
          silenceMs: 500,
          segments: [
            { startMs: 0, endMs: 1500 },
            { startMs: 1700, endMs: 3500 }
          ]
        }
      }),
    getScenarioTemplate: () =>
      Effect.succeed({
        template: {
          templateId: "template-1",
          topic: "travel",
          level: "A2",
          seedPrompt: "Hola, ¿cómo estás?",
          turnPlan: [],
          roleRubrics: [
            {
              roleId: "user",
              targetVocab: ["hola", "gracias", "buenos días"],
              targetGrammar: []
            }
          ]
        },
        templateVersion: "tpl-version-1"
      }),
    isMessageProcessed: () => Effect.succeed(false),
    markMessageProcessed: () => Effect.void,
    cleanupOldProcessedMessages: () => Effect.void,
    getRoomByRequestId: () => Effect.succeed(null),
    recordRoomRequest: () => Effect.void,
    getTurnByRequestId: () => Effect.succeed(null),
    recordTurnRequest: () => Effect.void,
    getAudioUploadByTurnId: () =>
      Effect.succeed(
        options?.audioUploadExists !== false
          ? { audioKey: "turns/turn-integration-test", requestId: "req-1" }
          : null
      ),
    getAudioUploadByRequestId: () => Effect.succeed(null),
    recordAudioUpload: () => Effect.void,
    recordAudioUploadRequest: () => Effect.void,
    insertScenarioTemplate: () => Effect.void
  });

/**
 * Create a mock RoomDoClient layer for testing.
 */
const makeDoLayer = (options?: { onEmit?: (roomId: string, event: unknown) => void }) =>
  Layer.succeed(RoomDoClient, {
    emitRoomEvent: (roomId, event) =>
      Effect.sync(() => {
        options?.onEmit?.(roomId, event);
      })
  });

describe("LanguageReviewConfigurable layer", () => {
  it("provides LanguageReview service when mode=mock", async () => {
    const envLayer = Layer.succeed(Env, makeMockEnv("mock"));
    const languageReviewLayer = LanguageReviewConfigurable.pipe(Layer.provide(envLayer));

    // Direct test: can we get the LanguageReview service?
    const program = Effect.gen(function* () {
      const service = yield* Effect.serviceOption(LanguageReview);
      return service;
    }).pipe(Effect.provide(languageReviewLayer));

    const result = await Effect.runPromise(program);
    expect(result._tag).toBe("Some");
  });

  it("mock service returns expected values", async () => {
    const envLayer = Layer.succeed(Env, makeMockEnv("mock"));
    const languageReviewLayer = LanguageReviewConfigurable.pipe(Layer.provide(envLayer));

    const program = Effect.gen(function* () {
      const service = yield* LanguageReview;
      return yield* service.review({
        mode: "spoken",
        language: "es",
        transcript: "Hola"
      });
    }).pipe(Effect.provide(languageReviewLayer));

    const result = await Effect.runPromise(program);
    expect(result.subscores.naturalness).toBe(72);
    expect(result.modelVersion).toBe("mock-v1");
  });
});

describe("TurnScoringConsumer Integration (mock mode)", () => {
  it("uses mock LanguageReview and produces deterministic scores", async () => {
    let capturedScore: unknown = null;
    let emittedEvents: Array<{ roomId: string; event: unknown }> = [];

    // Build layer with LANGUAGE_REVIEW_MODE=mock
    const envLayer = Layer.succeed(Env, makeMockEnv("mock"));
    const dbLayer = makeDbLayer({
      onUpdateTurnScore: (input) => {
        capturedScore = input;
      }
    });
    const doLayer = makeDoLayer({
      onEmit: (roomId, event) => {
        emittedEvents.push({ roomId, event });
      }
    });

    // LanguageReviewConfigurable requires Env, so provide it first
    const languageReviewLayer = LanguageReviewConfigurable.pipe(Layer.provide(envLayer));

    // Real ScoringServiceLive - uses Effect.serviceOption(LanguageReview) internally
    const scoringLayer = ScoringServiceLive.pipe(Layer.provideMerge(ScoringConfigLive));

    // Merge all layers - LanguageReview must be in the runtime context for serviceOption to find it
    const fullLayer = Layer.mergeAll(dbLayer, scoringLayer, doLayer, languageReviewLayer);

    // Create consumer and run handle - both need the full layer for LanguageReview
    const program = Effect.gen(function* () {
      const consumer = yield* makeTurnScoringConsumer;
      yield* consumer.handle({
        roomId: "room-integration-test",
        turnId: "turn-integration-test",
        status: "final"
      });
    }).pipe(Effect.provide(fullLayer));

    await Effect.runPromise(program);

    // Verify score was captured
    expect(capturedScore).not.toBeNull();
    const score = capturedScore as { turnId: string; overall: number; detailJson: string };

    // Parse the evaluation
    const evaluation = Schema.decodeUnknownSync(Schema.parseJson(TurnEvaluation))(score.detailJson);

    // Verify mock LanguageReview values are used
    // Mock returns: naturalness: 72, modelVersion: "mock-v1", confidence: 0.85
    expect(evaluation.scores.naturalness).toBe(72);
    expect(evaluation.modelVersion).toBe("mock-v1");
    expect(evaluation.confidence).toBe(0.85);

    // Verify mock feedback is included
    expect(evaluation.feedback).toContain("Clear pronunciation");
    expect(evaluation.feedback).toContain("Good vocabulary usage");
    expect(evaluation.feedback).toContain("Consider varying sentence structure");

    // Verify next prompt from mock
    expect(evaluation.nextPrompt).toContain("Good work!");

    // Verify partial + final events were emitted
    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[0]!.roomId).toBe("room-integration-test");
    expect((emittedEvents[0]!.event as { type: string }).type).toBe("ScoreUpdated");
    expect((emittedEvents[0]!.event as { status: string }).status).toBe("partial");
    expect((emittedEvents[1]!.event as { status: string }).status).toBe("final");
  });

  it("falls back gracefully when LanguageReview is disabled", async () => {
    let capturedScore: unknown = null;
    let emittedEvents: Array<{ roomId: string; event: unknown }> = [];

    // Build layer with LANGUAGE_REVIEW_MODE=disabled
    const envLayer = Layer.succeed(Env, makeMockEnv("disabled"));
    const dbLayer = makeDbLayer({
      onUpdateTurnScore: (input) => {
        capturedScore = input;
      }
    });
    const doLayer = makeDoLayer({
      onEmit: (roomId, event) => {
        emittedEvents.push({ roomId, event });
      }
    });

    // LanguageReviewConfigurable requires Env, so provide it first
    const languageReviewLayer = LanguageReviewConfigurable.pipe(Layer.provide(envLayer));

    // Real ScoringServiceLive - uses Effect.serviceOption(LanguageReview) internally
    const scoringLayer = ScoringServiceLive.pipe(Layer.provideMerge(ScoringConfigLive));

    // Merge all layers - LanguageReview must be in the runtime context for serviceOption to find it
    const fullLayer = Layer.mergeAll(dbLayer, scoringLayer, doLayer, languageReviewLayer);

    // Create consumer and run handle - both need the full layer for LanguageReview
    const program = Effect.gen(function* () {
      const consumer = yield* makeTurnScoringConsumer;
      yield* consumer.handle({
        roomId: "room-integration-test",
        turnId: "turn-integration-test",
        status: "final"
      });
    }).pipe(Effect.provide(fullLayer));

    await Effect.runPromise(program);

    // Verify score was captured
    expect(capturedScore).not.toBeNull();
    const score = capturedScore as { turnId: string; overall: number; detailJson: string };

    // Parse the evaluation
    const evaluation = Schema.decodeUnknownSync(Schema.parseJson(TurnEvaluation))(score.detailJson);

    // When disabled, naturalness falls back to 0 (no LLM)
    expect(evaluation.scores.naturalness).toBe(0);

    // Model version falls back to config default ("mvp")
    expect(evaluation.modelVersion).toBe("mvp");

    // Confidence falls back to 0
    expect(evaluation.confidence).toBe(0);

    // No feedback from LLM
    expect(evaluation.feedback).toEqual([]);

    // Empty next prompt
    expect(evaluation.nextPrompt).toBe("");

    // Partial + final events still emitted
    expect(emittedEvents).toHaveLength(2);
  });

  it("fluency and vocab scores are computed locally (not from mock)", async () => {
    let capturedScore: unknown = null;

    const envLayer = Layer.succeed(Env, makeMockEnv("mock"));
    const dbLayer = makeDbLayer({
      onUpdateTurnScore: (input) => {
        capturedScore = input;
      }
    });
    const doLayer = makeDoLayer();

    // LanguageReviewConfigurable requires Env, so provide it first
    const languageReviewLayer = LanguageReviewConfigurable.pipe(Layer.provide(envLayer));

    // Real ScoringServiceLive - uses Effect.serviceOption(LanguageReview) internally
    const scoringLayer = ScoringServiceLive.pipe(Layer.provideMerge(ScoringConfigLive));

    // Merge all layers - LanguageReview must be in the runtime context for serviceOption to find it
    const fullLayer = Layer.mergeAll(dbLayer, scoringLayer, doLayer, languageReviewLayer);

    // Create consumer and run handle - both need the full layer for LanguageReview
    const program = Effect.gen(function* () {
      const consumer = yield* makeTurnScoringConsumer;
      yield* consumer.handle({
        roomId: "room-integration-test",
        turnId: "turn-integration-test",
        status: "final"
      });
    }).pipe(Effect.provide(fullLayer));

    await Effect.runPromise(program);

    const score = capturedScore as { turnId: string; overall: number; detailJson: string };
    const evaluation = Schema.decodeUnknownSync(Schema.parseJson(TurnEvaluation))(score.detailJson);

    // Fluency is computed from audioStats (speechMs/totalMs ratio etc.)
    // With 3000ms speech / 3500ms total = ~85% speech ratio → high fluency
    expect(evaluation.scores.fluency).toBeGreaterThan(50);

    // Vocab is computed from transcript matching targetVocab
    // Transcript has "hola" and "gracias" which are in targetVocab
    // At least one match should give some vocab score
    expect(evaluation.scores.vocab).toBeGreaterThan(0);

    // Naturalness comes from mock (72)
    expect(evaluation.scores.naturalness).toBe(72);

    // Overall is weighted combination: fluency(0.4) + vocab(0.3) + naturalness(0.3)
    const expectedOverall =
      Math.round(evaluation.scores.fluency * 0.4 + evaluation.scores.vocab * 0.3 + evaluation.scores.naturalness * 0.3);
    expect(evaluation.overallScore).toBe(expectedOverall);
  });
});
