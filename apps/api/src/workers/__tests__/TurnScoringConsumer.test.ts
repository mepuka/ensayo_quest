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
  let emitted: Array<string> = [];
  let scoringInput: unknown = null;
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
    confidence: 0.8
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
      }),
    isMessageProcessed: () => Effect.succeed(false),
    markMessageProcessed: () => Effect.void,
    cleanupOldProcessedMessages: () => Effect.void,
    getTurnByRequestId: () => Effect.succeed(null),
    recordTurnRequest: () => Effect.void,
    getAudioUploadByTurnId: () => Effect.succeed(null),
    getAudioUploadByRequestId: () => Effect.succeed(null),
    recordAudioUpload: () => Effect.void,
    recordAudioUploadRequest: () => Effect.void
  });
  const scoringLayer = Layer.succeed(ScoringService, {
    evaluate: (input) =>
      Effect.sync(() => {
        scoringInput = input;
        return evaluation;
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
    targetVocab: ["adios"]
  });
  expect(emitted).toEqual(["ScoreUpdated"]);
});
