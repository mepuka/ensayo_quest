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
  createRoom: (roomId: string, templateId: string) => Effect.Effect<void, DbError, never>;
  insertTurn: (submission: TurnSubmission) => Effect.Effect<void, DbError, never>;
  getRoomTemplateId: (roomId: string) => Effect.Effect<string, DbError, never>;
  getNextTurnIndex: (roomId: string) => Effect.Effect<number, DbError, never>;
  findScenarioTemplate: (input: { topic: string; level: string }) => Effect.Effect<ScenarioTemplate, DbError, never>;
  getTurnSubmission: (turnId: string) => Effect.Effect<TurnSubmission, DbError, never>;
  getScenarioTemplate: (templateId: string) => Effect.Effect<ScenarioTemplate, DbError, never>;
  updateTurnAudioKey: (input: { turnId: string; audioKey: string }) => Effect.Effect<void, DbError, never>;
  updateTurnScore: (input: {
    turnId: string;
    overall: number;
    detailJson: string;
  }) => Effect.Effect<void, DbError, never>;
  // Queue idempotency
  isMessageProcessed: (messageId: string) => Effect.Effect<boolean, DbError, never>;
  markMessageProcessed: (messageId: string) => Effect.Effect<void, DbError, never>;
  cleanupOldProcessedMessages: (olderThanMs: number) => Effect.Effect<void, DbError, never>;
  // Room request idempotency (Architecture Invariant #10)
  // @see docs/ARCHITECTURE.md - Invariant #10: Room creation idempotent via requestId
  getRoomByRequestId: (requestId: string) => Effect.Effect<string | null, DbError, never>;
  recordRoomRequest: (requestId: string, roomId: string) => Effect.Effect<void, DbError, never>;
  // Turn request idempotency (Architecture Invariant #2)
  getTurnByRequestId: (roomId: string, requestId: string) => Effect.Effect<string | null, DbError, never>;
  recordTurnRequest: (roomId: string, requestId: string, turnId: string) => Effect.Effect<void, DbError, never>;
  // Audio upload idempotency (Architecture Invariant #2, #9)
  // @see docs/plans/2026-01-16-frontend-voice-stack-design.md - Section 5
  getAudioUploadByTurnId: (turnId: string) => Effect.Effect<{ audioKey: string; requestId: string } | null, DbError, never>;
  getAudioUploadByRequestId: (turnId: string, requestId: string) => Effect.Effect<string | null, DbError, never>;
  recordAudioUpload: (input: {
    turnId: string;
    requestId: string;
    audioKey: string;
    contentType: string | null;
    fileSizeBytes: number;
  }) => Effect.Effect<void, DbError, never>;
  recordAudioUploadRequest: (input: {
    turnId: string;
    requestId: string;
    audioKey: string;
  }) => Effect.Effect<void, DbError, never>;
  // Scenario template seeding
  insertScenarioTemplate: (input: {
    template: ScenarioTemplate;
    region: string;
    register: string;
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
      createRoom: (roomId: string, templateId: string) =>
        run(queries.insertRoom, [roomId, templateId, Date.now()]),
      getRoomTemplateId: (roomId: string) =>
        Effect.tryPromise({
          try: () =>
            env.DB.prepare(queries.selectRoomTemplateId)
              .bind(roomId)
              .first(),
          catch: (cause) => new DbError({ reason: String(cause) })
        }).pipe(
          Effect.flatMap((row) =>
            row
              ? Effect.succeed(row)
              : Effect.fail(new DbError({ reason: "room_not_found" }))
          ),
          Effect.flatMap((row) =>
            Effect.try({
              try: () => {
                const record = row as Record<string, unknown>;
                return String(record.template_id ?? "");
              },
              catch: (cause) => new DbError({ reason: String(cause) })
            })
          )
        ),
      getNextTurnIndex: (roomId: string) =>
        Effect.tryPromise({
          try: () =>
            env.DB.prepare(queries.selectNextTurnIndex)
              .bind(roomId)
              .first(),
          catch: (cause) => new DbError({ reason: String(cause) })
        }).pipe(
          Effect.flatMap((row) =>
            row
              ? Effect.succeed(row)
              : Effect.fail(new DbError({ reason: "turn_index_unavailable" }))
          ),
          Effect.flatMap((row) =>
            Effect.try({
              try: () => {
                const record = row as Record<string, unknown>;
                return Number(record.next_index ?? 0);
              },
              catch: (cause) => new DbError({ reason: String(cause) })
            })
          )
        ),
      findScenarioTemplate: (input: { topic: string; level: string }) =>
        Effect.tryPromise({
          try: () =>
            env.DB.prepare(queries.selectScenarioTemplateByTopicLevel)
              .bind(input.topic, input.level)
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
        ]),
      // Queue idempotency
      isMessageProcessed: (messageId: string) =>
        Effect.tryPromise({
          try: () => env.DB.prepare(queries.checkMessageProcessed).bind(messageId).first(),
          catch: (cause) => new DbError({ reason: String(cause) })
        }).pipe(Effect.map((row) => row !== null)),
      markMessageProcessed: (messageId: string) =>
        run(queries.markMessageProcessed, [messageId, Date.now()]),
      cleanupOldProcessedMessages: (olderThanMs: number) =>
        run(queries.cleanupOldProcessedMessages, [Date.now() - olderThanMs]),
      // Room request idempotency (Architecture Invariant #10)
      // @see docs/ARCHITECTURE.md - Invariant #10: Room creation idempotent via requestId
      getRoomByRequestId: (requestId: string) =>
        Effect.tryPromise({
          try: () => env.DB.prepare(queries.getRoomByRequestId).bind(requestId).first(),
          catch: (cause) => new DbError({ reason: String(cause) })
        }).pipe(
          Effect.map((row) => {
            if (!row) return null;
            const record = row as Record<string, unknown>;
            return String(record.room_id ?? "");
          })
        ),
      recordRoomRequest: (requestId: string, roomId: string) =>
        run(queries.recordRoomRequest, [requestId, roomId, Date.now()]),
      // Turn request idempotency (Architecture Invariant #2)
      getTurnByRequestId: (roomId: string, requestId: string) =>
        Effect.tryPromise({
          try: () => env.DB.prepare(queries.getTurnByRequestId).bind(roomId, requestId).first(),
          catch: (cause) => new DbError({ reason: String(cause) })
        }).pipe(
          Effect.map((row) => {
            if (!row) return null;
            const record = row as Record<string, unknown>;
            return String(record.turn_id ?? "");
          })
        ),
      recordTurnRequest: (roomId: string, requestId: string, turnId: string) =>
        run(queries.recordTurnRequest, [roomId, requestId, turnId, Date.now()]),
      // Audio upload idempotency (Architecture Invariant #2, #9)
      getAudioUploadByTurnId: (turnId: string) =>
        Effect.tryPromise({
          try: () => env.DB.prepare(queries.getAudioUploadByTurnId).bind(turnId).first(),
          catch: (cause) => new DbError({ reason: String(cause) })
        }).pipe(
          Effect.map((row) => {
            if (!row) return null;
            const record = row as Record<string, unknown>;
            return {
              audioKey: String(record.audio_key ?? ""),
              requestId: String(record.request_id ?? "")
            };
          })
        ),
      getAudioUploadByRequestId: (turnId: string, requestId: string) =>
        Effect.tryPromise({
          try: () => env.DB.prepare(queries.getAudioUploadByRequestId).bind(turnId, requestId).first(),
          catch: (cause) => new DbError({ reason: String(cause) })
        }).pipe(
          Effect.map((row) => {
            if (!row) return null;
            const record = row as Record<string, unknown>;
            return String(record.audio_key ?? "");
          })
        ),
      recordAudioUpload: (input: {
        turnId: string;
        requestId: string;
        audioKey: string;
        contentType: string | null;
        fileSizeBytes: number;
      }) =>
        run(queries.recordAudioUpload, [
          input.turnId,
          input.requestId,
          input.audioKey,
          input.contentType,
          input.fileSizeBytes,
          Date.now()
        ]),
      recordAudioUploadRequest: (input: {
        turnId: string;
        requestId: string;
        audioKey: string;
      }) =>
        run(queries.recordAudioUploadRequest, [
          input.turnId,
          input.requestId,
          input.audioKey,
          Date.now()
        ]),
      // Scenario template seeding
      insertScenarioTemplate: (input: {
        template: ScenarioTemplate;
        region: string;
        register: string;
      }) =>
        run(queries.insertScenarioTemplate, [
          input.template.templateId,
          input.template.topic,
          input.template.level,
          input.region,
          input.register,
          JSON.stringify(Schema.encodeSync(ScenarioTemplate)(input.template)),
          Date.now()
        ])
    };
  })
);
