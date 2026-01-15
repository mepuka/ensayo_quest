import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { decodeTurnSubmission } from "../domain/TurnSubmission";
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
    try: () => decodeTurnSubmission(input),
    catch: (error) =>
      new InvalidTurnSubmission({
        reason: error instanceof Error ? error.message : "invalid_turn_submission"
      })
  });

export const createRoom = Effect.fn(function* () {
  const db = yield* Db;
  const generator = yield* RoomIdGenerator;
  const roomId = yield* generator.generate;
  yield* db.createRoom(roomId);
  return { roomId, seedPrompt: "Hola" };
});

export const submitTurn = Effect.fn(function* (
  input: unknown,
  options?: { turnstileToken?: string }
) {
  const db = yield* Db;
  const queue = yield* TurnQueue;
  const turnstile = yield* Turnstile;
  const roomDo = yield* RoomDoClient;
  const submission = yield* validateTurnSubmission(input);
  if (options?.turnstileToken) {
    const ok = yield* turnstile.verifyToken(options.turnstileToken);
    if (!ok) {
      return yield* new TurnstileFailed({ reason: "turnstile_failed" });
    }
  }
  yield* db.insertTurn(submission);
  yield* queue.enqueueTurn({
    roomId: submission.roomId,
    turnId: submission.turnId,
    status: "partial"
  });
  yield* roomDo.emitRoomEvent(
    submission.roomId,
    new TurnAccepted({ type: "TurnAccepted", turnId: submission.turnId })
  );
  return { turnId: submission.turnId, status: "processing" as const };
});

export const uploadTurnAudio = Effect.fn(function* (input: {
  turnId: string;
  audio: ArrayBuffer;
  contentType?: string;
}) {
  const bucket = yield* AudioBucket;
  const db = yield* Db;
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
