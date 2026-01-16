import { it, expect } from "bun:test";
import { Effect } from "effect";
import { createRoom, submitTurn, validateTurnSubmission } from "../handlers";
import { Db } from "../../services/Db";
import { RoomIdGenerator } from "../../services/RoomIdGenerator";
import { TurnQueue } from "../../services/TurnQueue";
import type { TurnJob } from "../../services/TurnQueue";
import { Turnstile } from "../../security/Turnstile";
import { RoomDoClient } from "../../services/RoomDoClient";

it("rejects invalid TurnSubmission", () => {
  const result = Effect.runSync(Effect.either(validateTurnSubmission({})));
  expect(result._tag).toBe("Left");
});

it("createRoom selects a scenario and returns its seed prompt", async () => {
  let createdId = "";
  let createdTemplate = "";
  const result = await Effect.runPromise(
    createRoom({ topic: "travel", level: "A1", mode: "solo" }).pipe(
      Effect.provideService(Db, {
        createRoom: (roomId, templateId) =>
          Effect.sync(() => {
            createdId = roomId;
            createdTemplate = templateId;
          }),
        findScenarioTemplate: () =>
          Effect.succeed({
            templateId: "template-1",
            topic: "travel",
            level: "A1",
            seedPrompt: "Bienvenido",
            turnPlan: [],
            roleRubrics: []
          }),
        insertTurn: () => Effect.void,
        getTurnSubmission: () =>
          Effect.succeed({
            roomId: "r",
            turnId: "t",
            templateId: "tmp",
            turnIndex: 0,
            speakerUserId: "u",
            transcript: "hola",
            audioStats: { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] }
          }),
        getScenarioTemplate: () =>
          Effect.succeed({
            templateId: "tmp",
            topic: "travel",
            level: "A1",
            seedPrompt: "Hola",
            turnPlan: [],
            roleRubrics: []
          }),
        getRoomTemplateId: () => Effect.succeed("tmp"),
        getNextTurnIndex: () => Effect.succeed(0),
        updateTurnAudioKey: () => Effect.void,
        updateTurnScore: () => Effect.void,
        isMessageProcessed: () => Effect.succeed(false),
        markMessageProcessed: () => Effect.void,
        cleanupOldProcessedMessages: () => Effect.void,
        getTurnByRequestId: () => Effect.succeed(null),
        recordTurnRequest: () => Effect.void
      }),
      Effect.provideService(RoomIdGenerator, {
        generate: Effect.sync(() => "room-1")
      })
    )
  );
  expect(result.roomId).toBe("room-1");
  expect(result.seedPrompt).toBe("Bienvenido");
  expect(createdId).toBe("room-1");
  expect(createdTemplate).toBe("template-1");
});

it("submitTurn enqueues a job for valid input", async () => {
  let enqueued: Array<TurnJob> = [];
  let inserted: Array<string> = [];
  let emitted: Array<string> = [];
  const input = {
    roomId: "r",
    requestId: "req-1",
    transcript: "hola",
    language: "es",
    clientTimestamp: 123,
    audioFeatures: {
      durationMs: 1000,
      pauseCount: 2,
      speakingRateWpm: 120
    }
  };
  const result = await Effect.runPromise(
    submitTurn("r", input).pipe(
      Effect.provideService(Db, {
        createRoom: () => Effect.void as any,
        insertTurn: (submission) =>
          Effect.sync(() => {
            inserted.push(submission.turnId);
          }),
        getTurnSubmission: () =>
          Effect.succeed({
            roomId: "r",
            turnId: "t",
            templateId: "tmp",
            turnIndex: 0,
            speakerUserId: "u",
            transcript: "hola",
            audioStats: { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] }
          }),
        getScenarioTemplate: () =>
          Effect.succeed({
            templateId: "tmp",
            topic: "travel",
            level: "A1",
            seedPrompt: "Hola",
            turnPlan: [],
            roleRubrics: []
          }),
        getRoomTemplateId: () => Effect.succeed("template-1"),
        getNextTurnIndex: () => Effect.succeed(2),
        findScenarioTemplate: () =>
          Effect.succeed({
            templateId: "template-1",
            topic: "travel",
            level: "A1",
            seedPrompt: "Hola",
            turnPlan: [],
            roleRubrics: []
          }),
        updateTurnAudioKey: () => Effect.void,
        updateTurnScore: () => Effect.void,
        isMessageProcessed: () => Effect.succeed(false),
        markMessageProcessed: () => Effect.void,
        cleanupOldProcessedMessages: () => Effect.void,
        getTurnByRequestId: () => Effect.succeed(null),
        recordTurnRequest: () => Effect.void
      }),
      Effect.provideService(TurnQueue, {
        enqueueTurn: (job) =>
          Effect.sync(() => {
            enqueued.push(job);
          })
      }),
      Effect.provideService(RoomDoClient, {
        emitRoomEvent: (_roomId, event) =>
          Effect.sync(() => {
            emitted.push(event.type);
          })
      }),
      Effect.provideService(Turnstile, {
        verifyToken: () => Effect.succeed(true)
      }),
      Effect.provideService(RoomIdGenerator, {
        generate: Effect.sync(() => "turn-1")
      })
    )
  );
  expect(result.turnId).toBe("turn-1");
  expect(result.status).toBe("processing");
  expect(inserted).toEqual(["turn-1"]);
  expect(enqueued).toEqual([
    {
      roomId: "r",
      turnId: "turn-1",
      status: "partial"
    }
  ]);
  expect(emitted).toEqual(["TurnAccepted"]);
});

it("submitTurn rejects when Turnstile check fails", async () => {
  let enqueued: Array<TurnJob> = [];
  let inserted: Array<string> = [];
  let emitted: Array<string> = [];
  const input = {
    roomId: "r",
    requestId: "req-2",
    transcript: "hola",
    language: "es",
    clientTimestamp: 123,
    audioFeatures: {
      durationMs: 1000,
      pauseCount: 2,
      speakingRateWpm: 120
    }
  };
  const result = await Effect.runPromise(
    Effect.either(
      submitTurn("r", input, { turnstileToken: "invalid" }).pipe(
        Effect.provideService(Db, {
          createRoom: () => Effect.void as any,
          insertTurn: (submission) =>
            Effect.sync(() => {
              inserted.push(submission.turnId);
            }),
          getTurnSubmission: () =>
            Effect.succeed({
              roomId: "r",
              turnId: "t",
              templateId: "tmp",
              turnIndex: 0,
              speakerUserId: "u",
              transcript: "hola",
              audioStats: { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] }
            }),
          getScenarioTemplate: () =>
            Effect.succeed({
              templateId: "tmp",
              topic: "travel",
              level: "A1",
              seedPrompt: "Hola",
              turnPlan: [],
              roleRubrics: []
            }),
          getRoomTemplateId: () => Effect.succeed("template-1"),
          getNextTurnIndex: () => Effect.succeed(2),
          findScenarioTemplate: () =>
            Effect.succeed({
              templateId: "template-1",
              topic: "travel",
              level: "A1",
              seedPrompt: "Hola",
              turnPlan: [],
              roleRubrics: []
            }),
          updateTurnAudioKey: () => Effect.void,
          updateTurnScore: () => Effect.void,
          isMessageProcessed: () => Effect.succeed(false),
          markMessageProcessed: () => Effect.void,
          cleanupOldProcessedMessages: () => Effect.void,
          getTurnByRequestId: () => Effect.succeed(null),
          recordTurnRequest: () => Effect.void
        }),
        Effect.provideService(TurnQueue, {
          enqueueTurn: (job) =>
            Effect.sync(() => {
              enqueued.push(job);
            })
        }),
        Effect.provideService(RoomDoClient, {
          emitRoomEvent: (_roomId, event) =>
            Effect.sync(() => {
              emitted.push(event.type);
            })
        }),
        Effect.provideService(Turnstile, {
          verifyToken: () => Effect.succeed(false)
        }),
        Effect.provideService(RoomIdGenerator, {
          generate: Effect.sync(() => "turn-1")
        })
      )
    )
  );
  expect(result._tag).toBe("Left");
  expect(inserted).toEqual([]);
  expect(enqueued).toEqual([]);
  expect(emitted).toEqual([]);
});
