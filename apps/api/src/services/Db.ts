import { Context, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import type { TurnSubmission } from "../domain/TurnSubmission";
import { queries } from "../db/queries";
import { Env } from "./Env";

export class DbError extends Schema.TaggedError<DbError>()("DbError", {
  reason: Schema.String
}) {}

export interface DbService {
  createRoom: (roomId: string) => Effect.Effect<void, DbError, never>;
  insertTurn: (submission: TurnSubmission) => Effect.Effect<void, DbError, never>;
  updateTurnScore: (input: {
    turnId: string;
    overall: number;
    detailJson: string;
  }) => Effect.Effect<void, DbError, never>;
}

export class Db extends Context.Tag("Db")<Db, DbService>() {}

export const DbLive = Layer.effect(
  Db,
  Effect.gen(function* () {
    const env = yield* Env;
    const run = (sql: string, params: ReadonlyArray<unknown>) =>
      Effect.tryPromise({
        try: () => env.DB.prepare(sql).bind(...params).run(),
        catch: (cause) => new DbError({ reason: String(cause) })
      });
    return {
      createRoom: (roomId: string) =>
        run(queries.insertRoom, [roomId, "unknown", Date.now()]),
      insertTurn: (submission: TurnSubmission) =>
        run(queries.insertTurn, [
          submission.turnId,
          submission.roomId,
          submission.speakerUserId,
          submission.transcript,
          "received",
          Date.now()
        ]),
      updateTurnScore: (input: { turnId: string; overall: number; detailJson: string }) =>
        run(queries.updateTurnScore, [
          input.turnId,
          input.overall,
          input.detailJson
        ])
    };
  })
);
