import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { decodeTurnSubmission } from "../domain/TurnSubmission";
import { Db } from "../services/Db";
import { RoomIdGenerator } from "../services/RoomIdGenerator";
import { TurnQueue } from "../services/TurnQueue";
import { Turnstile } from "../security/Turnstile";

export class InvalidTurnSubmission extends Schema.TaggedError<InvalidTurnSubmission>()(
  "InvalidTurnSubmission",
  { reason: Schema.String }
) {}

export class TurnstileFailed extends Schema.TaggedError<TurnstileFailed>()("TurnstileFailed", {
  reason: Schema.String
}) {}

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
  return { roomId };
});

export const submitTurn = Effect.fn(function* (
  input: unknown,
  options?: { turnstileToken?: string }
) {
  const db = yield* Db;
  const queue = yield* TurnQueue;
  const turnstile = yield* Turnstile;
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
    overall: 0,
    detailJson: "{}",
    status: "partial"
  });
  return { turnId: submission.turnId, status: "processing" as const };
});

export const streamRoom = Effect.succeed({ status: "streaming" as const });

export const handlers = { validateTurnSubmission, createRoom, submitTurn, streamRoom };
