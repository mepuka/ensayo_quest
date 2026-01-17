import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { TurnSubmission } from "../domain/TurnSubmission";
import { decodeHttpTurnSubmission } from "../domain/HttpProtocol";
import { Db } from "../services/Db";
import { AudioBucket } from "../services/CloudflareLayers";
import { RoomIdGenerator } from "../services/RoomIdGenerator";
import { Turnstile } from "../security/Turnstile";
import { RoomDoClient } from "../services/RoomDoClient";
import { TurnAccepted, AudioUploaded, RoomInitialized } from "../domain/RoomProtocol";

export class InvalidTurnSubmission extends Schema.TaggedError<InvalidTurnSubmission>()(
  "InvalidTurnSubmission",
  { reason: Schema.String }
) {}

export class TurnstileFailed extends Schema.TaggedError<TurnstileFailed>()("TurnstileFailed", {
  reason: Schema.String
}) {}

export class AudioUploadFailed extends Schema.TaggedError<AudioUploadFailed>()(
  "AudioUploadFailed",
  { reason: Schema.String }
) {}

// Audio validation constants
const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB - conservative limit
const MIN_AUDIO_SIZE = 100; // Reject trivially small files
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/mp3",
  "audio/mpeg",
  "application/octet-stream" // Allow binary fallback
]);

export const validateTurnSubmission = (input: unknown) =>
  Effect.try({
    try: () => decodeHttpTurnSubmission(input),
    catch: (error) =>
      new InvalidTurnSubmission({
        reason: error instanceof Error ? error.message : "invalid_turn_submission"
      })
  });

/**
 * Create a room with idempotency support.
 *
 * Uses atomicity gap recovery pattern: ALWAYS re-emit RoomInitialized event on retry.
 * The DO handler has its own idempotency guard to prevent duplicate state creation.
 *
 * @see docs/ARCHITECTURE.md - Invariant #10: Room creation idempotent via requestId
 */
export const createRoom = Effect.fn("handlers.createRoom")(function* (input: {
  requestId: string;
  topic: string;
  level: string;
  mode: string;
}) {
  const db = yield* Db;
  const roomDo = yield* RoomDoClient;
  const generator = yield* RoomIdGenerator;

  // Idempotency check - get cached roomId if request already processed
  const existingRoomId = yield* db.getRoomByRequestId(input.requestId);

  if (existingRoomId) {
    // Atomicity gap recovery: ALWAYS re-emit event on retry
    // (same pattern as uploadTurnAudio - DB succeeded but DO might have failed)
    // DO handler has its own idempotency guard
    const templateId = yield* db.getRoomTemplateId(existingRoomId);
    const template = yield* db.getScenarioTemplate(templateId);

    // STRICT IDEMPOTENCY: Use template's canonical topic/level, NOT input
    // First request "wins" - subsequent retries with same requestId get identical result
    yield* roomDo.emitRoomEvent(
      existingRoomId,
      new RoomInitialized({
        type: "RoomInitialized",
        roomId: existingRoomId,
        scenarioId: templateId,
        seedPrompt: template.seedPrompt,
        topic: template.topic,
        level: template.level,
        timestamp: Date.now()
      })
    );

    return { roomId: existingRoomId, seedPrompt: template.seedPrompt };
  }

  // First request - create room
  const roomId = yield* generator.generate;
  const template = yield* db.findScenarioTemplate({
    topic: input.topic,
    level: input.level
  });
  yield* db.createRoom(roomId, template.templateId);
  yield* db.recordRoomRequest(input.requestId, roomId);

  // Emit RoomInitialized event
  yield* roomDo.emitRoomEvent(
    roomId,
    new RoomInitialized({
      type: "RoomInitialized",
      roomId,
      scenarioId: template.templateId,
      seedPrompt: template.seedPrompt,
      topic: input.topic,
      level: input.level,
      timestamp: Date.now()
    })
  );

  return { roomId, seedPrompt: template.seedPrompt };
});

/**
 * Submit a turn for processing.
 *
 * NOTE: Scoring is NOT enqueued here. Scoring is enqueued when AudioUploaded
 * event is received (Architecture Invariant #9).
 *
 * @see docs/ARCHITECTURE.md - Invariant #9: Scoring gated on AudioUploaded
 */
export const submitTurn = Effect.fn("handlers.submitTurn")(function* (
  roomId: string,
  input: unknown,
  options?: { turnstileToken?: string }
) {
  const db = yield* Db;
  const turnstile = yield* Turnstile;
  const roomDo = yield* RoomDoClient;
  const generator = yield* RoomIdGenerator;
  const submission = yield* validateTurnSubmission(input);
  if (submission.roomId !== roomId) {
    return yield* new InvalidTurnSubmission({ reason: "room_id_mismatch" });
  }
  if (options?.turnstileToken) {
    const ok = yield* turnstile.verifyToken(options.turnstileToken);
    if (!ok) {
      return yield* new TurnstileFailed({ reason: "turnstile_failed" });
    }
  }

  // Idempotency check: return cached turnId if request already processed
  // Architecture Invariant #2: All commands are idempotent via requestId
  const existingTurnId = yield* db.getTurnByRequestId(roomId, submission.requestId);
  if (existingTurnId) {
    yield* Effect.logDebug(`Returning cached turnId for requestId ${submission.requestId}`);
    return { turnId: existingTurnId, status: "processing" as const };
  }

  const templateId = yield* db.getRoomTemplateId(roomId);
  const turnIndex = yield* db.getNextTurnIndex(roomId);
  const turnId = yield* generator.generate;
  const derived = new TurnSubmission({
    roomId,
    turnId,
    templateId,
    turnIndex,
    speakerUserId: "user",
    transcript: submission.transcript,
    audioStats: {
      totalMs: submission.audioFeatures.durationMs,
      speechMs: submission.audioFeatures.durationMs,
      silenceMs: 0,
      segments: []
    }
  });
  yield* db.insertTurn(derived);

  // Record request → turnId mapping for idempotency
  yield* db.recordTurnRequest(roomId, submission.requestId, turnId);

  // Emit TurnAccepted - client knows turn was recorded
  // NOTE: Scoring will be enqueued when client uploads audio (AudioUploaded event)
  yield* roomDo.emitRoomEvent(
    roomId,
    new TurnAccepted({ type: "TurnAccepted", turnId })
  );
  return { turnId, status: "processing" as const };
});

/**
 * Upload audio for a turn with atomicity-safe idempotency.
 *
 * Implements Architecture Invariants #2 (idempotency) and #9 (AudioUploaded gates scoring).
 * @see docs/plans/2026-01-16-frontend-voice-stack-design.md - Section 5
 */
export const uploadTurnAudio = Effect.fn("handlers.uploadTurnAudio")(function* (input: {
  turnId: string;
  roomId: string;
  requestId: string;
  audio: ArrayBuffer;
  contentType?: string;
}) {
  const bucket = yield* AudioBucket;
  const db = yield* Db;
  const roomDo = yield* RoomDoClient;

  // 1. Validate audio size and content-type
  if (input.audio.byteLength > MAX_AUDIO_SIZE) {
    return yield* new AudioUploadFailed({
      reason: `audio_too_large: ${input.audio.byteLength} bytes exceeds ${MAX_AUDIO_SIZE} byte limit`
    });
  }
  if (input.audio.byteLength < MIN_AUDIO_SIZE) {
    return yield* new AudioUploadFailed({ reason: "audio_too_small" });
  }
  if (input.contentType && !ALLOWED_AUDIO_TYPES.has(input.contentType)) {
    return yield* new AudioUploadFailed({
      reason: `invalid_content_type: ${input.contentType}`
    });
  }

  // 2. Verify turn exists and belongs to the room
  const turn = yield* db.getTurnSubmission(input.turnId).pipe(
    Effect.mapError((cause) => new AudioUploadFailed({ reason: String(cause) }))
  );
  if (turn.roomId !== input.roomId) {
    return yield* new AudioUploadFailed({ reason: "room_id_mismatch" });
  }

  const audioKey = `turns/${input.turnId}`;
  const contentType = input.contentType ?? "audio/wav";

  // 3. Per-turn idempotency guard (only one audio per turn)
  const existingTurnUpload = yield* db.getAudioUploadByTurnId(input.turnId).pipe(
    Effect.mapError((cause) => new AudioUploadFailed({ reason: String(cause) }))
  );

  if (existingTurnUpload) {
    // Turn already has audio - emit event anyway to handle atomicity gap
    // (R2 + DB succeeded but DO event might have failed on previous attempt)
    yield* roomDo.emitRoomEvent(
      input.roomId,
      new AudioUploaded({
        type: "AudioUploaded",
        roomId: input.roomId,
        turnId: input.turnId,
        audioKey: existingTurnUpload.audioKey,
        requestId: existingTurnUpload.requestId,
        contentType,
        fileSizeBytes: input.audio.byteLength,
        timestamp: Date.now()
      })
    ).pipe(
      Effect.mapError((cause) => new AudioUploadFailed({ reason: String(cause) }))
    );
    return { audioKey: existingTurnUpload.audioKey, status: "already_uploaded" as const };
  }

  // 4. Per-request idempotency check (same requestId = same request retry)
  const existingRequest = yield* db.getAudioUploadByRequestId(input.turnId, input.requestId).pipe(
    Effect.mapError((cause) => new AudioUploadFailed({ reason: String(cause) }))
  );

  if (!existingRequest) {
    // 5. Upload to R2 (first upload for this turn)
    yield* Effect.tryPromise({
      try: () =>
        bucket.put(audioKey, input.audio, {
          httpMetadata: { contentType }
        }),
      catch: (cause) => new AudioUploadFailed({ reason: String(cause) })
    });

    // 6. Record upload for idempotency
    yield* db.recordAudioUpload({
      turnId: input.turnId,
      requestId: input.requestId,
      audioKey,
      contentType,
      fileSizeBytes: input.audio.byteLength
    }).pipe(
      Effect.mapError((cause) => new AudioUploadFailed({ reason: String(cause) }))
    );

    yield* db.recordAudioUploadRequest({
      turnId: input.turnId,
      requestId: input.requestId,
      audioKey
    }).pipe(
      Effect.mapError((cause) => new AudioUploadFailed({ reason: String(cause) }))
    );

    // 7. Update turn with audio key (legacy field)
    yield* db.updateTurnAudioKey({ turnId: input.turnId, audioKey });
  }

  // 8. Emit AudioUploaded event to DO (always, even on retry for atomicity)
  // DO event handler will check its own idempotency and enqueue scoring
  yield* roomDo.emitRoomEvent(
    input.roomId,
    new AudioUploaded({
      type: "AudioUploaded",
      roomId: input.roomId,
      turnId: input.turnId,
      audioKey,
      requestId: input.requestId,
      contentType,
      fileSizeBytes: input.audio.byteLength,
      timestamp: Date.now()
    })
  ).pipe(
    Effect.mapError((cause) => new AudioUploadFailed({ reason: String(cause) }))
  );

  return { audioKey, status: "uploaded" as const };
});

export const streamRoom = Effect.succeed({ status: "streaming" as const });

export const handlers = {
  validateTurnSubmission,
  createRoom,
  submitTurn,
  uploadTurnAudio,
  streamRoom
};
