import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { TurnSubmission } from "../domain/TurnSubmission";
import { decodeHttpTurnSubmission } from "../domain/HttpProtocol";
import { Db } from "../services/Db";
import { AudioBucket } from "../services/CloudflareLayers";
import { RoomIdGenerator } from "../services/RoomIdGenerator";
import { TurnQueue } from "../services/TurnQueue";
import { Turnstile } from "../security/Turnstile";
import { RoomDoClient } from "../services/RoomDoClient";
import { TurnAccepted } from "../domain/RoomProtocol";

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

export const submitTurn = Effect.fn(function* (
  roomId: string,
  input: unknown,
  options?: { turnstileToken?: string }
) {
  const db = yield* Db;
  const queue = yield* TurnQueue;
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
  yield* queue.enqueueTurn({
    roomId,
    turnId,
    status: "partial"
  });
  yield* roomDo.emitRoomEvent(
    roomId,
    new TurnAccepted({ type: "TurnAccepted", turnId })
  );
  return { turnId, status: "processing" as const };
});

export const uploadTurnAudio = Effect.fn(function* (input: {
  turnId: string;
  audio: ArrayBuffer;
  contentType?: string;
}) {
  const bucket = yield* AudioBucket;
  const db = yield* Db;
  yield* db.getTurnSubmission(input.turnId).pipe(
    Effect.mapError((cause) => new AudioUploadFailed({ reason: String(cause) }))
  );
  const audioKey = `turns/${input.turnId}`;
  yield* Effect.tryPromise({
    try: () =>
      bucket.put(audioKey, input.audio, {
        httpMetadata: {
          contentType: input.contentType ?? "application/octet-stream"
        }
      }),
    catch: (cause) => new AudioUploadFailed({ reason: String(cause) })
  });
  yield* db.updateTurnAudioKey({ turnId: input.turnId, audioKey });
  return { audioKey };
});

export const streamRoom = Effect.succeed({ status: "streaming" as const });

export const handlers = {
  validateTurnSubmission,
  createRoom,
  submitTurn,
  uploadTurnAudio,
  streamRoom
};
