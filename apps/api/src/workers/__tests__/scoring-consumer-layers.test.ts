/**
 * Integration tests for TurnScoringConsumer using reusable test layers.
 *
 * Demonstrates usage of the new test layer infrastructure from apps/api/src/test/layers/.
 * These tests are faster and more focused than the full integration tests since they
 * use mock layers instead of real services.
 *
 * Test cases:
 * 1. Scores turn when audio upload exists
 * 2. Skips scoring when no audio upload exists (defense in depth)
 * 3. Deduplicates queue messages via message ID tracking
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { makeTurnScoringConsumer } from "../TurnScoringConsumer";
import {
  makeDbTestState,
  makeDbTestLayerSeeded,
  makeScoringTestLayer,
  makeRoomDoTestLayer,
  type DbTestState
} from "../../test/layers";
import { TurnSubmission } from "../../domain/TurnSubmission";
import { TurnEvaluation } from "../../domain/RoomProtocol";
import type { RoomEvent } from "../../domain/RoomProtocol";
import type { TurnScoringInput } from "../../services/ScoringService";

describe("TurnScoringConsumer with Test Layers", () => {
  let dbState: DbTestState;
  let emittedEvents: Array<{ roomId: string; event: RoomEvent }>;
  let evaluatedInputs: Array<TurnScoringInput>;

  beforeEach(() => {
    dbState = makeDbTestState();
    emittedEvents = [];
    evaluatedInputs = [];
  });

  /**
   * Helper: Set up test data in dbState
   */
  const setupTestData = (options: { withAudioUpload?: boolean } = {}) => {
    const roomId = `room-${crypto.randomUUID().slice(0, 8)}`;
    const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
    const templateId = "tpl-travel-a2";

    // Pre-seed scenarios
    const { seedScenarios } = require("../../seed/SeedData");
    seedScenarios.forEach((s: { template: { templateId: string } }) =>
      dbState.scenarios.set(s.template.templateId, s.template)
    );

    // Create room
    dbState.rooms.set(roomId, { templateId });

    // Create turn submission
    dbState.turns.set(
      turnId,
      new TurnSubmission({
        roomId,
        turnId,
        templateId,
        turnIndex: 0,
        speakerUserId: "user-test",
        transcript: "Hola, quiero un billete de ida a Madrid.",
        audioStats: {
          totalMs: 3000,
          speechMs: 2500,
          silenceMs: 500,
          segments: [{ startMs: 200, endMs: 2700 }]
        }
      })
    );

    // Optionally add audio upload
    if (options.withAudioUpload !== false) {
      dbState.audioUploads.set(turnId, {
        audioKey: `turns/${turnId}/audio.webm`,
        requestId: crypto.randomUUID(),
        contentType: "audio/webm",
        fileSizeBytes: 15000
      });
    }

    return { roomId, turnId, templateId };
  };

  /**
   * Helper: Build test layer composition
   */
  const buildTestLayers = () => {
    const dbLayer = Layer.succeed(
      require("../../services/Db").Db,
      {
        createRoom: (roomId: string, templateId: string) =>
          Effect.sync(() => {
            dbState.rooms.set(roomId, { templateId });
          }),
        getRoomTemplateId: (roomId: string) => {
          const room = dbState.rooms.get(roomId);
          return room
            ? Effect.succeed(room.templateId)
            : Effect.fail(new (require("../../services/Db").DbError)({ reason: "room_not_found" }));
        },
        insertTurn: (submission: TurnSubmission) =>
          Effect.sync(() => {
            dbState.turns.set(submission.turnId, submission);
          }),
        getTurnSubmission: (turnId: string) => {
          const turn = dbState.turns.get(turnId);
          return turn
            ? Effect.succeed(turn)
            : Effect.fail(new (require("../../services/Db").DbError)({ reason: "turn_not_found" }));
        },
        getNextTurnIndex: (roomId: string) => {
          const count = [...dbState.turns.values()].filter((t) => t.roomId === roomId).length;
          return Effect.succeed(count);
        },
        updateTurnAudioKey: () => Effect.void,
        updateTurnScore: (input: { turnId: string; overall: number; detailJson: string }) =>
          Effect.sync(() => {
            dbState.scores.set(input.turnId, {
              overall: input.overall,
              detailJson: input.detailJson
            });
          }),
        findScenarioTemplate: ({ topic, level }: { topic: string; level: string }) => {
          for (const scenario of dbState.scenarios.values()) {
            if (scenario.topic === topic && scenario.level === level) {
              return Effect.succeed(scenario);
            }
          }
          return Effect.fail(new (require("../../services/Db").DbError)({ reason: "scenario_not_found" }));
        },
        getScenarioTemplate: (templateId: string) => {
          const scenario = dbState.scenarios.get(templateId);
          return scenario
            ? Effect.succeed(scenario)
            : Effect.fail(new (require("../../services/Db").DbError)({ reason: "scenario_not_found" }));
        },
        insertScenarioTemplate: () => Effect.void,
        isMessageProcessed: (messageId: string) => Effect.succeed(dbState.processedMessages.has(messageId)),
        markMessageProcessed: (messageId: string) =>
          Effect.sync(() => {
            dbState.processedMessages.add(messageId);
          }),
        cleanupOldProcessedMessages: () => Effect.void,
        getRoomByRequestId: (requestId: string) =>
          Effect.succeed(dbState.roomRequests.get(requestId) ?? null),
        recordRoomRequest: (requestId: string, roomId: string) =>
          Effect.sync(() => {
            dbState.roomRequests.set(requestId, roomId);
          }),
        getTurnByRequestId: (roomId: string, requestId: string) =>
          Effect.succeed(dbState.turnRequests.get(`${roomId}:${requestId}`) ?? null),
        recordTurnRequest: (roomId: string, requestId: string, turnId: string) =>
          Effect.sync(() => {
            dbState.turnRequests.set(`${roomId}:${requestId}`, turnId);
          }),
        getAudioUploadByTurnId: (turnId: string) => {
          const upload = dbState.audioUploads.get(turnId);
          return Effect.succeed(
            upload ? { audioKey: upload.audioKey, requestId: upload.requestId } : null
          );
        },
        getAudioUploadByRequestId: (turnId: string, requestId: string) => {
          const key = `${turnId}:${requestId}`;
          return Effect.succeed(dbState.audioUploadRequests.get(key) ?? null);
        },
        recordAudioUpload: () => Effect.void,
        recordAudioUploadRequest: () => Effect.void
      }
    );

    const scoringLayer = makeScoringTestLayer({
      mockScore: 75,
      onEvaluate: (input) => evaluatedInputs.push(input)
    });

    const roomDoLayer = makeRoomDoTestLayer({
      onEmit: (roomId, event) => emittedEvents.push({ roomId, event })
    });

    return Layer.mergeAll(dbLayer, scoringLayer, roomDoLayer);
  };

  it("scores turn when audio upload exists", async () => {
    const { roomId, turnId } = setupTestData({ withAudioUpload: true });
    const fullLayer = buildTestLayers();

    const program = Effect.gen(function* () {
      const consumer = yield* makeTurnScoringConsumer;
      yield* consumer.handle({
        roomId,
        turnId,
        status: "final"
      });
    }).pipe(Effect.provide(fullLayer));

    await Effect.runPromise(program);

    // Verify score was stored
    const score = dbState.scores.get(turnId);
    expect(score).toBeDefined();
    expect(score!.overall).toBe(75); // from mock

    // Verify evaluation structure
    const evaluation = Schema.decodeUnknownSync(Schema.parseJson(TurnEvaluation))(score!.detailJson);
    expect(evaluation.modelVersion).toBe("mock-v1");
    expect(evaluation.turnId).toBe(turnId);

    // Verify ScoringService.evaluate was called
    expect(evaluatedInputs).toHaveLength(1);
    expect(evaluatedInputs[0]!.turnId).toBe(turnId);
    expect(evaluatedInputs[0]!.transcript).toBe("Hola, quiero un billete de ida a Madrid.");

    // Verify ScoreUpdated event emitted
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.roomId).toBe(roomId);
    expect(emittedEvents[0]!.event.type).toBe("ScoreUpdated");
  });

  it("skips scoring when no audio upload exists (defense in depth)", async () => {
    const { roomId, turnId } = setupTestData({ withAudioUpload: false });
    const fullLayer = buildTestLayers();

    const program = Effect.gen(function* () {
      const consumer = yield* makeTurnScoringConsumer;
      yield* consumer.handle({
        roomId,
        turnId,
        status: "final"
      });
    }).pipe(Effect.provide(fullLayer));

    await Effect.runPromise(program);

    // No score should be stored
    expect(dbState.scores.get(turnId)).toBeUndefined();

    // ScoringService.evaluate should NOT have been called
    expect(evaluatedInputs).toHaveLength(0);

    // No events should have been emitted
    expect(emittedEvents).toHaveLength(0);
  });

  it("processes same turn multiple times (idempotency at consumer level)", async () => {
    // Note: The TurnScoringConsumer itself doesn't implement message-level idempotency
    // (that's handled by the queue infrastructure via isMessageProcessed/markMessageProcessed).
    // This test verifies that processing the same turn twice still works (upsert semantics).
    const { roomId, turnId } = setupTestData({ withAudioUpload: true });
    const fullLayer = buildTestLayers();

    const program = Effect.gen(function* () {
      const consumer = yield* makeTurnScoringConsumer;
      // Process same message twice
      yield* consumer.handle({ roomId, turnId, status: "final" });
      yield* consumer.handle({ roomId, turnId, status: "final" });
    }).pipe(Effect.provide(fullLayer));

    await Effect.runPromise(program);

    // Score should still be valid (second write overwrites first)
    const score = dbState.scores.get(turnId);
    expect(score).toBeDefined();
    expect(score!.overall).toBe(75);

    // Scoring was called twice (no dedup at this level)
    expect(evaluatedInputs).toHaveLength(2);

    // Two events emitted
    expect(emittedEvents).toHaveLength(2);
  });

  it("fails with non-retryable error for invalid payload", async () => {
    const fullLayer = buildTestLayers();

    const program = Effect.gen(function* () {
      const consumer = yield* makeTurnScoringConsumer;
      yield* consumer.handle({ invalid: "payload" });
    }).pipe(Effect.provide(fullLayer));

    const result = await Effect.runPromise(Effect.either(program));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("TurnScoringNonRetryableError");
    }
  });

  it("fails with non-retryable error when turn not found", async () => {
    // Setup with audio but don't create the turn
    const roomId = `room-${crypto.randomUUID().slice(0, 8)}`;
    const turnId = `turn-nonexistent`;

    // Pre-seed scenarios
    const { seedScenarios } = require("../../seed/SeedData");
    seedScenarios.forEach((s: { template: { templateId: string } }) =>
      dbState.scenarios.set(s.template.templateId, s.template)
    );

    // Room exists
    dbState.rooms.set(roomId, { templateId: "tpl-travel-a2" });

    // Audio upload exists
    dbState.audioUploads.set(turnId, {
      audioKey: `turns/${turnId}/audio.webm`,
      requestId: crypto.randomUUID(),
      contentType: "audio/webm",
      fileSizeBytes: 15000
    });

    // But turn doesn't exist!

    const fullLayer = buildTestLayers();

    const program = Effect.gen(function* () {
      const consumer = yield* makeTurnScoringConsumer;
      yield* consumer.handle({ roomId, turnId, status: "final" });
    }).pipe(Effect.provide(fullLayer));

    const result = await Effect.runPromise(Effect.either(program));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("TurnScoringNonRetryableError");
      expect((result.left as { reason: string }).reason).toContain("not_found");
    }
  });
});
