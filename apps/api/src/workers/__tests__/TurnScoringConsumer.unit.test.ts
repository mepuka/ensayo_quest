import { it, expect, describe } from "bun:test";
import { Effect, Layer } from "effect";
import { makeTurnScoringConsumer } from "../TurnScoringConsumer";
import { Db } from "../../services/Db";
import { RoomDoClient } from "../../services/RoomDoClient";
import { ScoringConfigLive, ScoringServiceLive } from "../../services/ScoringService";
import { LanguageReview } from "../../services/LanguageReview";

// TODO: Re-enable when LanguageReview service is properly mocked
it.skip("emits ScoreUpdated with language review feedback", async () => {
  let emitted: unknown = null;
  const reviewOutput = {
    subscores: {
      fluency: 80,
      vocab: 55,
      grammar: 60,
      relevance: 70,
      pronunciation: 50,
      naturalness: 65
    },
    feedback: {
      wins: ["Buen ritmo"],
      fixes: ["Usa mas conectores"]
    },
    correctedPhrases: [],
    nextPrompt: "Pide la cuenta.",
    confidence: 0.7,
    modelVersion: "gemini-3"
  };
  const dbLayer = Layer.succeed(Db, {
    createRoom: () => Effect.void,
    insertTurn: () => Effect.void,
    updateTurnScore: () => Effect.void,
    updateTurnAudioKey: () => Effect.void,
    getRoomTemplateId: () => Effect.succeed("template-1"),
    getNextTurnIndex: () => Effect.succeed(0),
    findScenarioTemplate: () =>
      Effect.succeed({
        templateId: "template-1",
        topic: "restaurant",
        level: "A2",
        seedPrompt: "Hola",
        turnPlan: [],
        roleRubrics: [{ roleId: "A", targetVocab: ["menu"], targetGrammar: [] }]
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
        topic: "restaurant",
        level: "A2",
        seedPrompt: "Hola",
        turnPlan: [],
        roleRubrics: [{ roleId: "A", targetVocab: ["menu"], targetGrammar: [] }]
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
  const doLayer = Layer.succeed(RoomDoClient, {
    emitRoomEvent: (_roomId, event) =>
      Effect.sync(() => {
        emitted = event;
      })
  });
  const reviewLayer = Layer.succeed(LanguageReview, {
    review: () => Effect.succeed(reviewOutput)
  });
  const scoringLayer = ScoringServiceLive.pipe(
    Layer.provideMerge(ScoringConfigLive),
    Layer.provideMerge(reviewLayer)
  );
  const consumer = await Effect.runPromise(
    makeTurnScoringConsumer.pipe(
      Effect.provide(Layer.mergeAll(dbLayer, doLayer, scoringLayer))
    )
  );
  await Effect.runPromise(
    consumer.handle({
      roomId: "r1",
      turnId: "t1",
      status: "final"
    })
  );
  if (!emitted || typeof emitted !== "object") {
    throw new Error("expected ScoreUpdated to be emitted");
  }
  const event = emitted as {
    type: string;
    evaluation: {
      feedback: Array<string>;
      nextPrompt: string;
      modelVersion: string;
      confidence: number;
      scores: { naturalness: number };
    };
  };
  expect(event.type).toBe("ScoreUpdated");
  expect(event.evaluation.feedback).toEqual(["Buen ritmo", "Usa mas conectores"]);
  expect(event.evaluation.nextPrompt).toBe("Pide la cuenta.");
  expect(event.evaluation.modelVersion).toBe("gemini-3");
  expect(event.evaluation.confidence).toBe(0.7);
  expect(event.evaluation.scores.naturalness).toBe(65);
});
