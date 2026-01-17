import { it, expect } from "bun:test";
import { Effect } from "effect";
import { createRoom, submitTurn, validateTurnSubmission } from "../handlers";
import { Db } from "../../services/Db";
import { RoomIdGenerator } from "../../services/RoomIdGenerator";
import { Turnstile } from "../../security/Turnstile";
import { RoomDoClient } from "../../services/RoomDoClient";

it("rejects invalid TurnSubmission", () => {
  const result = Effect.runSync(Effect.either(validateTurnSubmission({})));
  expect(result._tag).toBe("Left");
});

/**
 * Test createRoom idempotency retry path (Architecture Invariant #10).
 * When requestId already exists, returns cached roomId and re-emits event.
 */
it("createRoom returns cached roomId on retry and re-emits RoomInitialized", async () => {
  let createRoomCalled = false;
  let emittedEvents: Array<unknown> = [];
  const result = await Effect.runPromise(
    createRoom({ requestId: "req-existing", topic: "travel", level: "A1", mode: "solo" }).pipe(
      Effect.provideService(Db, {
        createRoom: () =>
          Effect.sync(() => {
            createRoomCalled = true;
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
            templateId: "template-1",
            topic: "travel",
            level: "A1",
            seedPrompt: "Bienvenido",
            turnPlan: [],
            roleRubrics: []
          }),
        getRoomTemplateId: () => Effect.succeed("template-1"),
        getNextTurnIndex: () => Effect.succeed(0),
        updateTurnAudioKey: () => Effect.void,
        updateTurnScore: () => Effect.void,
        isMessageProcessed: () => Effect.succeed(false),
        markMessageProcessed: () => Effect.void,
        cleanupOldProcessedMessages: () => Effect.void,
        // Retry path: requestId already exists with cached roomId
        getRoomByRequestId: () => Effect.succeed("room-cached"),
        recordRoomRequest: () => Effect.void,
        getTurnByRequestId: () => Effect.succeed(null),
        recordTurnRequest: () => Effect.void,
        getAudioUploadByTurnId: () => Effect.succeed(null),
        getAudioUploadByRequestId: () => Effect.succeed(null),
        recordAudioUpload: () => Effect.void,
        recordAudioUploadRequest: () => Effect.void,
        insertScenarioTemplate: () => Effect.void
      }),
      Effect.provideService(RoomIdGenerator, {
        generate: Effect.sync(() => "room-new") // Should NOT be used on retry
      }),
      Effect.provideService(RoomDoClient, {
        emitRoomEvent: (_roomId, event) =>
          Effect.sync(() => {
            emittedEvents.push(event);
          })
      })
    )
  );
  // Returns cached roomId, not newly generated one
  expect(result.roomId).toBe("room-cached");
  expect(result.seedPrompt).toBe("Bienvenido");
  // createRoom should NOT be called on retry
  expect(createRoomCalled).toBe(false);
  // Event should still be emitted (atomicity gap recovery)
  expect(emittedEvents.length).toBe(1);
  expect((emittedEvents[0] as { type: string }).type).toBe("RoomInitialized");
});

it("createRoom selects a scenario, emits RoomInitialized, and returns its seed prompt", async () => {
  let createdId = "";
  let createdTemplate = "";
  let emittedEvent: unknown = null;
  const result = await Effect.runPromise(
    createRoom({ requestId: "req-1", topic: "travel", level: "A1", mode: "solo" }).pipe(
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
        // Room request idempotency (Architecture Invariant #10)
        getRoomByRequestId: () => Effect.succeed(null),
        recordRoomRequest: () => Effect.void,
        getTurnByRequestId: () => Effect.succeed(null),
        recordTurnRequest: () => Effect.void,
        getAudioUploadByTurnId: () => Effect.succeed(null),
        getAudioUploadByRequestId: () => Effect.succeed(null),
        recordAudioUpload: () => Effect.void,
        recordAudioUploadRequest: () => Effect.void,
        insertScenarioTemplate: () => Effect.void
      }),
      Effect.provideService(RoomIdGenerator, {
        generate: Effect.sync(() => "room-1")
      }),
      Effect.provideService(RoomDoClient, {
        emitRoomEvent: (_roomId, event) =>
          Effect.sync(() => {
            emittedEvent = event;
          })
      })
    )
  );
  expect(result.roomId).toBe("room-1");
  expect(result.seedPrompt).toBe("Bienvenido");
  expect(createdId).toBe("room-1");
  expect(createdTemplate).toBe("template-1");
  expect(emittedEvent).not.toBeNull();
  expect((emittedEvent as { type: string }).type).toBe("RoomInitialized");
});

/**
 * submitTurn no longer enqueues scoring.
 * Scoring is now enqueued by AudioUploaded event handler (Architecture Invariant #9).
 * @see docs/ARCHITECTURE.md - Invariant #9: Scoring gated on AudioUploaded
 */
it("submitTurn records turn and emits TurnAccepted (without enqueuing scoring)", async () => {
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
        // Room request idempotency (Architecture Invariant #10)
        getRoomByRequestId: () => Effect.succeed(null),
        recordRoomRequest: () => Effect.void,
        getTurnByRequestId: () => Effect.succeed(null),
        recordTurnRequest: () => Effect.void,
        getAudioUploadByTurnId: () => Effect.succeed(null),
        getAudioUploadByRequestId: () => Effect.succeed(null),
        recordAudioUpload: () => Effect.void,
        recordAudioUploadRequest: () => Effect.void,
        insertScenarioTemplate: () => Effect.void
      }),
      // NOTE: TurnQueue is NOT needed - scoring is enqueued by AudioUploaded handler
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
  // NOTE: No scoring enqueued - that happens in AudioUploaded handler
  expect(emitted).toEqual(["TurnAccepted"]);
});

it("submitTurn rejects when Turnstile check fails", async () => {
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
          // Room request idempotency (Architecture Invariant #10)
          getRoomByRequestId: () => Effect.succeed(null),
          recordRoomRequest: () => Effect.void,
          getTurnByRequestId: () => Effect.succeed(null),
          recordTurnRequest: () => Effect.void,
          getAudioUploadByTurnId: () => Effect.succeed(null),
          getAudioUploadByRequestId: () => Effect.succeed(null),
          recordAudioUpload: () => Effect.void,
          recordAudioUploadRequest: () => Effect.void,
          insertScenarioTemplate: () => Effect.void
        }),
        // NOTE: TurnQueue is NOT needed - scoring is enqueued by AudioUploaded handler
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
  expect(emitted).toEqual([]);
});
