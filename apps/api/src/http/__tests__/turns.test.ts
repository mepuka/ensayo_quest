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

it("createRoom creates a room id", async () => {
  let createdId = "";
  const result = await Effect.runPromise(
    createRoom().pipe(
      Effect.provideService(Db, {
        createRoom: (roomId) =>
          Effect.sync(() => {
            createdId = roomId;
          }),
        insertTurn: () => Effect.void,
        updateTurnScore: () => Effect.void
      }),
      Effect.provideService(RoomIdGenerator, {
        generate: Effect.sync(() => "room-1")
      })
    )
  );
  expect(result.roomId).toBe("room-1");
  expect(result.seedPrompt).toBe("Hola");
  if (createdId.length === 0) {
    throw new Error("room id was not created");
  }
  expect(createdId).toBe("room-1");
});

it("submitTurn enqueues a job for valid input", async () => {
  let enqueued: Array<TurnJob> = [];
  let inserted: Array<string> = [];
  let emitted: Array<string> = [];
  const input = {
    roomId: "r",
    turnId: "t",
    templateId: "tmp",
    turnIndex: 0,
    speakerUserId: "u",
    transcript: "hola",
    audioStats: { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] }
  };
  const result = await Effect.runPromise(
    submitTurn(input).pipe(
      Effect.provideService(Db, {
        createRoom: () => Effect.void,
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
            turnPlan: [],
            roleRubrics: []
          }),
        updateTurnAudioKey: () => Effect.void,
        updateTurnScore: () => Effect.void
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
      })
    )
  );
  expect(result.turnId).toBe("t");
  expect(result.status).toBe("processing");
  expect(inserted).toEqual(["t"]);
  expect(enqueued).toEqual([
    {
      roomId: "r",
      turnId: "t",
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
    turnId: "t",
    templateId: "tmp",
    turnIndex: 0,
    speakerUserId: "u",
    transcript: "hola",
    audioStats: { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] }
  };
  const result = await Effect.runPromise(
    Effect.either(
      submitTurn(input, { turnstileToken: "invalid" }).pipe(
        Effect.provideService(Db, {
          createRoom: () => Effect.void,
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
              turnPlan: [],
              roleRubrics: []
            }),
          updateTurnAudioKey: () => Effect.void,
          updateTurnScore: () => Effect.void
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
        })
      )
    )
  );
  expect(result._tag).toBe("Left");
  expect(inserted).toEqual([]);
  expect(enqueued).toEqual([]);
  expect(emitted).toEqual([]);
});
