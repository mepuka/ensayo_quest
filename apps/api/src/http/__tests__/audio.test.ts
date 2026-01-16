import { it, expect } from "bun:test";
import { Effect } from "effect";
import { uploadTurnAudio } from "../handlers";
import { Db, DbError, type DbService } from "../../services/Db";
import { AudioBucket } from "../../services/CloudflareLayers";
import { RoomDoClient } from "../../services/RoomDoClient";

const makeTestDb = (overrides: Partial<DbService> = {}): DbService => ({
  createRoom: () => Effect.void as any,
  findScenarioTemplate: () =>
    Effect.succeed({
      templateId: "tmp",
      topic: "travel",
      level: "A1",
      seedPrompt: "Hola",
      turnPlan: [],
      roleRubrics: []
    }),
  insertTurn: () => Effect.void,
  getRoomTemplateId: () => Effect.succeed("tmp"),
  getNextTurnIndex: () => Effect.succeed(0),
  getTurnSubmission: () =>
    Effect.succeed({
      roomId: "r1",
      turnId: "t1",
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
  updateTurnAudioKey: () => Effect.void,
  updateTurnScore: () => Effect.void,
  isMessageProcessed: () => Effect.succeed(false),
  markMessageProcessed: () => Effect.void,
  cleanupOldProcessedMessages: () => Effect.void,
  getTurnByRequestId: () => Effect.succeed(null),
  recordTurnRequest: () => Effect.void,
  // Audio upload idempotency
  getAudioUploadByTurnId: () => Effect.succeed(null),
  getAudioUploadByRequestId: () => Effect.succeed(null),
  recordAudioUpload: () => Effect.void,
  recordAudioUploadRequest: () => Effect.void,
  ...overrides
});

const makeTestBucket = (onPut?: (key: string) => void) => ({
  put: (key: string, _value: unknown, _options?: unknown) => {
    onPut?.(key);
    return Promise.resolve({} as R2Object);
  }
} as R2Bucket);

const makeTestRoomDoClient = (onEmit?: (roomId: string, event: unknown) => void) => ({
  emitRoomEvent: (roomId: string, event: unknown) => {
    onEmit?.(roomId, event);
    return Effect.void;
  }
});

// Valid audio size for tests (MIN_AUDIO_SIZE = 100)
const makeTestAudio = (size = 200) => new Uint8Array(size).buffer;

it("stores audio and updates audio key", async () => {
  let storedKey = "";
  let updatedKey = "";
  let emittedEvent: unknown = null;
  const audio = makeTestAudio();

  const result = await Effect.runPromise(
    uploadTurnAudio({
      turnId: "t1",
      roomId: "r1",
      requestId: "req1",
      audio,
      contentType: "audio/webm"
    }).pipe(
      Effect.provideService(AudioBucket, makeTestBucket((key) => { storedKey = key; })),
      Effect.provideService(Db, makeTestDb({
        updateTurnAudioKey: (input: { turnId: string; audioKey: string }) =>
          Effect.sync(() => {
            updatedKey = input.audioKey;
          })
      })),
      Effect.provideService(RoomDoClient, makeTestRoomDoClient((_roomId, event) => {
        emittedEvent = event;
      }))
    )
  );

  expect(result.audioKey).toBe("turns/t1");
  expect(result.status).toBe("uploaded");
  expect(storedKey).toBe("turns/t1");
  expect(updatedKey).toBe("turns/t1");
  expect(emittedEvent).not.toBeNull();
});

it("rejects audio upload for missing turns", async () => {
  let storedKey = "";
  const audio = makeTestAudio();

  const result = await Effect.runPromise(
    Effect.either(
      uploadTurnAudio({
        turnId: "missing",
        roomId: "r1",
        requestId: "req1",
        audio,
        contentType: "audio/webm"
      }).pipe(
        Effect.provideService(AudioBucket, makeTestBucket((key) => { storedKey = key; })),
        Effect.provideService(Db, makeTestDb({
          getTurnSubmission: () => Effect.fail(new DbError({ reason: "turn_not_found" }))
        })),
        Effect.provideService(RoomDoClient, makeTestRoomDoClient())
      )
    )
  );

  expect(result._tag).toBe("Left");
  expect(storedKey).toBe("");
});

it("returns existing audio key for duplicate turn upload", async () => {
  let storedKey = "";
  let emittedCount = 0;
  const audio = makeTestAudio();

  const result = await Effect.runPromise(
    uploadTurnAudio({
      turnId: "t1",
      roomId: "r1",
      requestId: "req2", // Different request ID
      audio,
      contentType: "audio/webm"
    }).pipe(
      Effect.provideService(AudioBucket, makeTestBucket((key) => { storedKey = key; })),
      Effect.provideService(Db, makeTestDb({
        getAudioUploadByTurnId: () =>
          Effect.succeed({ audioKey: "turns/t1", requestId: "req1" })
      })),
      Effect.provideService(RoomDoClient, makeTestRoomDoClient(() => { emittedCount++; }))
    )
  );

  expect(result.audioKey).toBe("turns/t1");
  expect(result.status).toBe("already_uploaded");
  expect(storedKey).toBe(""); // Should not upload again
  expect(emittedCount).toBe(1); // Should still emit event for atomicity
});

it("rejects upload when room ID does not match turn", async () => {
  const audio = makeTestAudio();

  const result = await Effect.runPromise(
    Effect.either(
      uploadTurnAudio({
        turnId: "t1",
        roomId: "wrong-room",
        requestId: "req1",
        audio,
        contentType: "audio/webm"
      }).pipe(
        Effect.provideService(AudioBucket, makeTestBucket()),
        Effect.provideService(Db, makeTestDb()),
        Effect.provideService(RoomDoClient, makeTestRoomDoClient())
      )
    )
  );

  expect(result._tag).toBe("Left");
  if (result._tag === "Left") {
    expect(result.left._tag).toBe("AudioUploadFailed");
  }
});

it("rejects audio that is too small", async () => {
  const tinyAudio = new Uint8Array(10).buffer; // Below MIN_AUDIO_SIZE

  const result = await Effect.runPromise(
    Effect.either(
      uploadTurnAudio({
        turnId: "t1",
        roomId: "r1",
        requestId: "req1",
        audio: tinyAudio,
        contentType: "audio/webm"
      }).pipe(
        Effect.provideService(AudioBucket, makeTestBucket()),
        Effect.provideService(Db, makeTestDb()),
        Effect.provideService(RoomDoClient, makeTestRoomDoClient())
      )
    )
  );

  expect(result._tag).toBe("Left");
  if (result._tag === "Left") {
    expect(result.left._tag).toBe("AudioUploadFailed");
    expect(result.left.reason).toContain("audio_too_small");
  }
});

it("rejects audio that is too large", async () => {
  const hugeAudio = new Uint8Array(11 * 1024 * 1024).buffer; // Above MAX_AUDIO_SIZE (10MB)

  const result = await Effect.runPromise(
    Effect.either(
      uploadTurnAudio({
        turnId: "t1",
        roomId: "r1",
        requestId: "req1",
        audio: hugeAudio,
        contentType: "audio/webm"
      }).pipe(
        Effect.provideService(AudioBucket, makeTestBucket()),
        Effect.provideService(Db, makeTestDb()),
        Effect.provideService(RoomDoClient, makeTestRoomDoClient())
      )
    )
  );

  expect(result._tag).toBe("Left");
  if (result._tag === "Left") {
    expect(result.left._tag).toBe("AudioUploadFailed");
    expect(result.left.reason).toContain("audio_too_large");
  }
});

it("rejects invalid content type", async () => {
  const audio = makeTestAudio();

  const result = await Effect.runPromise(
    Effect.either(
      uploadTurnAudio({
        turnId: "t1",
        roomId: "r1",
        requestId: "req1",
        audio,
        contentType: "video/mp4" // Not an allowed audio type
      }).pipe(
        Effect.provideService(AudioBucket, makeTestBucket()),
        Effect.provideService(Db, makeTestDb()),
        Effect.provideService(RoomDoClient, makeTestRoomDoClient())
      )
    )
  );

  expect(result._tag).toBe("Left");
  if (result._tag === "Left") {
    expect(result.left._tag).toBe("AudioUploadFailed");
    expect(result.left.reason).toContain("invalid_content_type");
  }
});
