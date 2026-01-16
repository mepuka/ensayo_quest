import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { TurnSubmission } from "../domain/TurnSubmission";
import { decodeHttpTurnSubmission } from "../domain/HttpProtocol";
import { Db } from "../services/Db";
import { AudioBucket } from "../services/CloudflareLayers";
import { RoomIdGenerator } from "../services/RoomIdGenerator";
import { Turnstile } from "../security/Turnstile";
import { RoomDoClient } from "../services/RoomDoClient";
import { TurnAccepted, AudioUploaded } from "../domain/RoomProtocol";

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

export const validateTurnSubmission = (input: unknown) =>
  Effect.try({
    try: () => decodeHttpTurnSubmission(input),
    catch: (error) =>
      new InvalidTurnSubmission({
        reason: error instanceof Error ? error.message : "invalid_turn_submission"
      })
  });

export const createRoom = Effect.fn(function* (input: {
  topic: string;
  level: string;
  mode: string;
}) {
  const db = yield* Db;
  const generator = yield* RoomIdGenerator;
  const roomId = yield* generator.generate;
  const template = yield* db.findScenarioTemplate({
    topic: input.topic,
    level: input.level
  });
  yield* db.createRoom(roomId, template.templateId);
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

  // 1. Verify turn exists and belongs to the room
  const turn = yield* db.getTurnSubmission(input.turnId).pipe(
    Effect.mapError((cause) => new AudioUploadFailed({ reason: String(cause) }))
  );
  if (turn.roomId !== input.roomId) {
    return yield* new AudioUploadFailed({ reason: "room_id_mismatch" });
  }

  const audioKey = `turns/${input.turnId}`;
  const contentType = input.contentType ?? "audio/wav";

  // 2. Per-turn idempotency guard (only one audio per turn)
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

  // 3. Per-request idempotency check (same requestId = same request retry)
  const existingRequest = yield* db.getAudioUploadByRequestId(input.turnId, input.requestId).pipe(
    Effect.mapError((cause) => new AudioUploadFailed({ reason: String(cause) }))
  );

  if (!existingRequest) {
    // 4. Upload to R2 (first upload for this turn)
    yield* Effect.tryPromise({
      try: () =>
        bucket.put(audioKey, input.audio, {
          httpMetadata: { contentType }
        }),
      catch: (cause) => new AudioUploadFailed({ reason: String(cause) })
    });

    // 5. Record upload for idempotency
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

    // 6. Update turn with audio key (legacy field)
    yield* db.updateTurnAudioKey({ turnId: input.turnId, audioKey });
  }

  // 7. Emit AudioUploaded event to DO (always, even on retry for atomicity)
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
