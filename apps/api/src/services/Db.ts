import { Context, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import type { TurnSubmission } from "../domain/TurnSubmission";
import { TurnSubmission as TurnSubmissionSchema } from "../domain/TurnSubmission";
import { ScenarioTemplate } from "../domain/ScenarioTemplate";
import { queries } from "../db/queries";
import { Env } from "./Env";

export class DbError extends Schema.TaggedError<DbError>()("DbError", {
  reason: Schema.String
}) {}

export interface DbService {
  createRoom: (roomId: string) => Effect.Effect<void, DbError, never>;
  insertTurn: (submission: TurnSubmission) => Effect.Effect<void, DbError, never>;
  getTurnSubmission: (turnId: string) => Effect.Effect<TurnSubmission, DbError, never>;
  getScenarioTemplate: (templateId: string) => Effect.Effect<ScenarioTemplate, DbError, never>;
  updateTurnAudioKey: (input: { turnId: string; audioKey: string }) => Effect.Effect<void, DbError, never>;
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
    const AudioStatsSchema = Schema.Struct({
      totalMs: Schema.Number,
      speechMs: Schema.Number,
      silenceMs: Schema.Number,
      segments: Schema.Array(
        Schema.Struct({
          startMs: Schema.Number,
          endMs: Schema.Number
        })
      )
    });
    const decodeAudioStats = Schema.decodeUnknownSync(Schema.parseJson(AudioStatsSchema));
    const decodeScenarioTemplate = Schema.decodeUnknownSync(
      Schema.parseJson(ScenarioTemplate)
    );
    return {
      createRoom: (roomId: string) =>
        run(queries.insertRoom, [roomId, "unknown", Date.now()]),
      insertTurn: (submission: TurnSubmission) =>
        run(queries.insertTurn, [
          submission.turnId,
          submission.roomId,
          submission.templateId,
          submission.turnIndex,
          submission.speakerUserId,
          submission.transcript,
          Schema.encodeSync(Schema.parseJson(AudioStatsSchema))(submission.audioStats),
          null,
          "received",
          Date.now()
        ]),
      getTurnSubmission: (turnId: string) =>
        Effect.tryPromise({
          try: () => env.DB.prepare(queries.selectTurnById).bind(turnId).first(),
          catch: (cause) => new DbError({ reason: String(cause) })
        }).pipe(
          Effect.flatMap((row) =>
            row
              ? Effect.succeed(row)
              : Effect.fail(new DbError({ reason: "turn_not_found" }))
          ),
          Effect.flatMap((row) =>
            Effect.try({
              try: () => {
                const record = row as Record<string, unknown>;
                return new TurnSubmissionSchema({
                  roomId: String(record.room_id ?? ""),
                  turnId: String(record.id ?? ""),
                  templateId: String(record.template_id ?? ""),
                  turnIndex: Number(record.turn_index ?? 0),
                  speakerUserId: String(record.speaker_user_id ?? ""),
                  transcript: String(record.transcript ?? ""),
                  audioStats: decodeAudioStats(String(record.audio_stats_json ?? ""))
                });
              },
              catch: (cause) => new DbError({ reason: String(cause) })
            })
          )
        ),
      getScenarioTemplate: (templateId: string) =>
        Effect.tryPromise({
          try: () =>
            env.DB.prepare(queries.selectScenarioTemplateById)
              .bind(templateId)
              .first(),
          catch: (cause) => new DbError({ reason: String(cause) })
        }).pipe(
          Effect.flatMap((row) =>
            row
              ? Effect.succeed(row)
              : Effect.fail(new DbError({ reason: "scenario_not_found" }))
          ),
          Effect.flatMap((row) =>
            Effect.try({
              try: () => {
                const record = row as Record<string, unknown>;
                return decodeScenarioTemplate(String(record.template_json ?? ""));
              },
              catch: (cause) => new DbError({ reason: String(cause) })
            })
          )
        ),
      updateTurnAudioKey: (input: { turnId: string; audioKey: string }) =>
        run(queries.updateTurnAudioKey, [input.audioKey, input.turnId]),
      updateTurnScore: (input: { turnId: string; overall: number; detailJson: string }) =>
        run(queries.updateTurnScore, [
          input.turnId,
          input.overall,
          input.detailJson
        ])
    };
  })
);
