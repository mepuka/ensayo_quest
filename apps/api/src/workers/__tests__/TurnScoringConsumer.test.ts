import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { makeTurnScoringConsumer } from "../TurnScoringConsumer";
import { Db } from "../../services/Db";
import { ScoringService } from "../../services/ScoringService";
import { RoomDoClient } from "../../services/RoomDoClient";
import { TurnEvaluation } from "../../domain/RoomProtocol";

it("scores turn and emits ScoreUpdated", async () => {
  let updated: unknown = null;
  let emitted: Array<unknown> = [];
  let scoringInput: unknown = null;
  let partialScoringInput: unknown = null;
  const evaluation = new TurnEvaluation({
    turnId: "t1",
    scores: {
      fluency: 80,
      vocab: 20,
      naturalness: 60
    },
    overallScore: 70,
    feedback: ["Buen trabajo"],
    nextPrompt: "Sigue",
    modelVersion: "test-model",
    confidence: 0.8,
    degraded: false
  });
  const partialEvaluation = new TurnEvaluation({
    turnId: "t1",
    scores: {
      fluency: 80,
      vocab: 20,
      naturalness: 0
    },
    overallScore: 54,
    feedback: [],
    nextPrompt: "",
    modelVersion: "test-model",
    confidence: 0,
    degraded: false
  });
  const dbLayer = Layer.succeed(Db, {
    createRoom: () => Effect.void,
    insertTurn: () => Effect.void,
    updateTurnScore: (input) =>
      Effect.sync(() => {
        updated = input;
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
          seedPrompt: "Hola",
          turnPlan: [],
          roleRubrics: [
            {
              roleId: "user",
              targetVocab: ["adios"],
              targetGrammar: []
            }
          ]
        },
        templateVersion: "tpl-version-1"
      }),
    getTurnSubmission: () =>
      Effect.succeed({
        roomId: "r1",
        turnId: "t1",
        templateId: "template-1",
        turnIndex: 0,
        speakerUserId: "user-1",
        transcript: "hola",
        audioStats: { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] }
      }),
    getScenarioTemplate: () =>
      Effect.succeed({
        template: {
          templateId: "template-1",
          topic: "travel",
          level: "A2",
          seedPrompt: "Hola",
          turnPlan: [],
          roleRubrics: [
            {
              roleId: "user",
              targetVocab: ["adios"],
              targetGrammar: []
            }
          ]
        },
        templateVersion: "tpl-version-1"
      }),
    isMessageProcessed: () => Effect.succeed(false),
    markMessageProcessed: () => Effect.void,
    cleanupOldProcessedMessages: () => Effect.void,
    // Room request idempotency (Architecture Invariant #10)
    getRoomByRequestId: () => Effect.succeed(null),
    recordRoomRequest: () => Effect.void,
    getTurnByRequestId: () => Effect.succeed(null),
    recordTurnRequest: () => Effect.void,
    getAudioUploadByTurnId: () => Effect.succeed({ audioKey: "turns/t1", requestId: "req-1" }),
    getAudioUploadByRequestId: () => Effect.succeed(null),
    recordAudioUpload: () => Effect.void,
    recordAudioUploadRequest: () => Effect.void,
    insertScenarioTemplate: () => Effect.void
  });
  const scoringLayer = Layer.succeed(ScoringService, {
    evaluateFinalWithFallback: (input) =>
      Effect.sync(() => {
        scoringInput = input;
        return evaluation;
      }),
    evaluatePartial: (input) =>
      Effect.sync(() => {
        partialScoringInput = input;
        return partialEvaluation;
      })
  });
  const doLayer = Layer.succeed(RoomDoClient, {
    emitRoomEvent: (_roomId, event) =>
      Effect.sync(() => {
        emitted.push(event);
      })
  });
  const consumer = await Effect.runPromise(
    makeTurnScoringConsumer.pipe(
      Effect.provide(Layer.mergeAll(dbLayer, scoringLayer, doLayer))
    )
  );
  await Effect.runPromise(
    consumer.handle({
      roomId: "r1",
      turnId: "t1",
      status: "final"
    })
  );
  if (!updated) {
    throw new Error("expected updateTurnScore to be called");
  }
  const ensured = updated as { turnId: string; overall: number; detailJson: string };
  const parsed = Schema.decodeUnknownSync(Schema.parseJson(TurnEvaluation))(ensured.detailJson);
  expect(ensured.turnId).toBe("t1");
  expect(ensured.overall).toBe(70);
  expect(parsed.modelVersion).toBe("test-model");
  expect(scoringInput).toEqual({
    turnId: "t1",
    transcript: "hola",
    audioStats: { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] },
    targetVocab: ["adios"],
    targetGrammar: []
  });
  expect(partialScoringInput).toEqual(scoringInput);
  expect(emitted).toHaveLength(2);
  expect((emitted[0] as { status: string }).status).toBe("partial");
  expect((emitted[1] as { status: string }).status).toBe("final");
  expect((emitted[0] as { scoreAttemptId: string }).scoreAttemptId)
    .toBe((emitted[1] as { scoreAttemptId: string }).scoreAttemptId);
  expect((emitted[0] as { evaluation: { feedback: string[] } }).evaluation.feedback).toEqual([]);
  expect((emitted[0] as { evaluation: { scores: { naturalness: number } } }).evaluation.scores.naturalness)
    .toBe(0);
});

it("skips scoring when AudioUploaded not found (defense in depth)", async () => {
  let updated = false;
  let emitted: Array<string> = [];
  let scoringCalled = false;

  const dbLayer = Layer.succeed(Db, {
    createRoom: () => Effect.void,
    insertTurn: () => Effect.void,
    updateTurnScore: () =>
      Effect.sync(() => {
        updated = true;
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
          seedPrompt: "Hola",
          turnPlan: [],
          roleRubrics: []
        },
        templateVersion: "tpl-version-1"
      }),
    getTurnSubmission: () =>
      Effect.succeed({
        roomId: "r1",
        turnId: "t1",
        templateId: "template-1",
        turnIndex: 0,
        speakerUserId: "user-1",
        transcript: "hola",
        audioStats: { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] }
      }),
    getScenarioTemplate: () =>
      Effect.succeed({
        template: {
          templateId: "template-1",
          topic: "travel",
          level: "A2",
          seedPrompt: "Hola",
          turnPlan: [],
          roleRubrics: []
        },
        templateVersion: "tpl-version-1"
      }),
    isMessageProcessed: () => Effect.succeed(false),
    markMessageProcessed: () => Effect.void,
    cleanupOldProcessedMessages: () => Effect.void,
    // Room request idempotency (Architecture Invariant #10)
    getRoomByRequestId: () => Effect.succeed(null),
    recordRoomRequest: () => Effect.void,
    getTurnByRequestId: () => Effect.succeed(null),
    recordTurnRequest: () => Effect.void,
    // No audio upload exists - this should trigger the defense in depth skip
    getAudioUploadByTurnId: () => Effect.succeed(null),
    getAudioUploadByRequestId: () => Effect.succeed(null),
    recordAudioUpload: () => Effect.void,
    recordAudioUploadRequest: () => Effect.void,
    insertScenarioTemplate: () => Effect.void
  });

  const scoringLayer = Layer.succeed(ScoringService, {
    evaluateFinalWithFallback: () =>
      Effect.sync(() => {
        scoringCalled = true;
        return new TurnEvaluation({
          turnId: "t1",
          scores: { fluency: 80, vocab: 20, naturalness: 60 },
          overallScore: 70,
          feedback: [],
          nextPrompt: "",
          modelVersion: "test",
          confidence: 0.8,
          degraded: false
        });
      }),
    evaluatePartial: () =>
      Effect.sync(() => {
        scoringCalled = true;
        return new TurnEvaluation({
          turnId: "t1",
          scores: { fluency: 80, vocab: 20, naturalness: 0 },
          overallScore: 54,
          feedback: [],
          nextPrompt: "",
          modelVersion: "test",
          confidence: 0,
          degraded: false
        });
      })
  });

  const doLayer = Layer.succeed(RoomDoClient, {
    emitRoomEvent: (_roomId, event) =>
      Effect.sync(() => {
        emitted.push(event.type);
      })
  });

  const consumer = await Effect.runPromise(
    makeTurnScoringConsumer.pipe(
      Effect.provide(Layer.mergeAll(dbLayer, scoringLayer, doLayer))
    )
  );

  // Should complete without error (ACK the message)
  await Effect.runPromise(
    consumer.handle({
      roomId: "r1",
      turnId: "t1",
      status: "final"
    })
  );

  // Scoring should NOT have been called
  expect(scoringCalled).toBe(false);
  // Score should NOT have been updated
  expect(updated).toBe(false);
  // No events should have been emitted
  expect(emitted).toEqual([]);
});
