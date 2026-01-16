/**
 * RoomDurableObject - Per-room singleton managing room state
 *
 * This DO is the source of truth for room state, using EventLog for atomic
 * event persistence with state projection.
 *
 * @see docs/ARCHITECTURE.md - Invariant #1: EventLog is the single source of truth
 * @see docs/ARCHITECTURE.md - Invariant #3: Event append + projections are atomic
 */
import type { SqlStorage } from "@cloudflare/workers-types";
import { EventLogDurableObject } from "@effect/experimental/EventLogServer/Cloudflare";
import * as EventLog from "@effect/experimental/EventLog";
import type { CloudflareEnv } from "../services/Env";
import { makeDoSqliteEventLogStorageLayer } from "./EventLogStorage";
import { decodeRoomEventEnvelopeMsgPack, type RoomEvent } from "../domain/RoomProtocol";
import { SqliteClient as DoSqliteClient } from "@effect/sql-sqlite-do";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Match from "effect/Match";
import { pipe } from "effect/Function";
import * as Config from "effect/Config";
import { applyRoomSchema } from "./db/schema";
import {
  RoomDomainLive,
  RoomEventSchema,
  RoomEventHandlerError,
  TurnAcceptedPayload,
  TurnAdvancedPayload,
  ScoreUpdatedPayload,
  RoomCompletedPayload,
  RoomErrorPayload,
  RoomStatePersistence,
  type RoomDomainContext
} from "../domain/index.js";
import { EventJournalError } from "@effect/experimental/EventJournal";

// =============================================================================
// Runtime Layer Construction
// =============================================================================

/**
 * Create the full runtime layer for the room domain.
 * Includes EventLog, handlers, state persistence, and SQL client.
 *
 * The SqlClient is merged into the output so it's available for schema migrations.
 */
const makeRoomDomainLayer = (storage: SqlStorage) => {
  const sqliteLayer = DoSqliteClient.layerConfig(Config.succeed({ db: storage }));
  // Merge SqlClient into output so it's available for applyRoomSchema
  return Layer.mergeAll(
    RoomDomainLive.pipe(Layer.provide(sqliteLayer)),
    sqliteLayer
  );
};

// Runtime context type - inferred from the layer
type RoomRuntimeLayer = ReturnType<typeof makeRoomDomainLayer>;
type RoomRuntimeContext = Layer.Layer.Success<RoomRuntimeLayer>;

// =============================================================================
// Event Conversion
// =============================================================================

/**
 * Error type for event emission failures.
 */
type EmitEventError = EventJournalError | RoomEventHandlerError;

/**
 * Convert legacy RoomEvent to domain event payloads.
 * This bridges the old protocol events to the new typed payloads.
 *
 * For TurnAccepted, also emits TurnAdvanced to advance the turn progression.
 * The idempotency check in the TurnAdvanced handler prevents double-advance on retry.
 */
const convertToPayload = (
  roomId: string,
  event: RoomEvent
): Effect.Effect<void, EmitEventError, EventLog.EventLog | RoomStatePersistence> =>
  Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const persistence = yield* RoomStatePersistence;
    const timestamp = Date.now();

    switch (event.type) {
      case "TurnAccepted": {
        // Get current state to determine step indices
        const currentState = yield* persistence.getState(roomId);
        const currentStepIndex = currentState?.currentStepIndex ?? 0;

        // Emit TurnAccepted first (transitions to Processing)
        yield* log.write({
          schema: RoomEventSchema,
          event: "TurnAccepted",
          payload: new TurnAcceptedPayload({
            roomId,
            turnId: event.turnId,
            playerId: "unknown", // TODO: Get from session context
            transcript: "", // TODO: Get from request
            timestamp
          })
        });

        // Emit TurnAdvanced to advance to next step
        // Idempotency is handled in the TurnAdvanced handler
        yield* log.write({
          schema: RoomEventSchema,
          event: "TurnAdvanced",
          payload: new TurnAdvancedPayload({
            roomId,
            fromStepIndex: currentStepIndex,
            toStepIndex: currentStepIndex + 1,
            nextParticipantType: "Player", // TODO: Determine from scenario
            nextParticipantId: "unknown" // TODO: Get next player from scenario
          })
        });
        break;
      }

      case "ScoreUpdated":
        yield* log.write({
          schema: RoomEventSchema,
          event: "ScoreUpdated",
          payload: new ScoreUpdatedPayload({
            roomId,
            turnId: event.turnId,
            scores: {
              fluency: event.evaluation.scores.fluency,
              vocab: event.evaluation.scores.vocab,
              naturalness: event.evaluation.scores.naturalness
            },
            overallScore: event.evaluation.overallScore,
            feedback: event.evaluation.feedback,
            nextPrompt: event.evaluation.nextPrompt
          })
        });
        break;

      case "RoomCompleted":
        yield* log.write({
          schema: RoomEventSchema,
          event: "RoomCompleted",
          payload: new RoomCompletedPayload({
            roomId,
            summary: event.summary,
            timestamp
          })
        });
        break;

      case "Error":
        yield* log.write({
          schema: RoomEventSchema,
          event: "RoomError",
          payload: new RoomErrorPayload({
            roomId,
            code: event.code,
            message: event.message,
            retryable: event.retryable,
            timestamp
          })
        });
        break;

      case "RoomSnapshot":
        // RoomSnapshot is a read event for clients, not persisted
        // State is derived from events, not snapshots
        yield* Effect.logDebug("RoomSnapshot is a read-only event, not persisted");
        break;
    }
  });

// =============================================================================
// RoomDurableObject
// =============================================================================

export class RoomDurableObject extends EventLogDurableObject {
  private readonly roomRuntime: ManagedRuntime.ManagedRuntime<RoomRuntimeContext, never>;

  constructor(state: DurableObjectState, env: CloudflareEnv) {
    const storage = (state.storage as DurableObjectStorage & { sql: SqlStorage }).sql;
    super({
      ctx: state,
      env,
      storageLayer: makeDoSqliteEventLogStorageLayer(storage).pipe(Layer.orDie)
    });

    // Create runtime with full domain layer
    this.roomRuntime = ManagedRuntime.make(
      makeRoomDomainLayer(storage).pipe(Layer.orDie)
    );

    // blockConcurrencyWhile ensures no requests are processed until schema is applied
    state.blockConcurrencyWhile(async () => {
      await this.roomRuntime.runPromise(applyRoomSchema);
    });
  }

  override async fetch(request?: Request): Promise<Response> {
    // Schema is guaranteed ready by blockConcurrencyWhile in constructor
    if (!request || request.headers.get("Upgrade") === "websocket") {
      return super.fetch();
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = new Uint8Array(await request.arrayBuffer());
    const envelope = decodeRoomEventEnvelopeMsgPack(body);

    // Use EventLog.write() for atomic event + state persistence
    // This satisfies Invariant #3: Event append + projections are atomic
    const result = await this.roomRuntime.runPromiseExit(
      convertToPayload(envelope.roomId, envelope.event)
    );

    // Handle success/failure with appropriate HTTP responses using Effect's Exit
    return pipe(
      result,
      Exit.match({
        onSuccess: () => new Response(null, { status: 204 }),
        onFailure: (cause) =>
          pipe(
            Cause.failureOption(cause),
            Option.match({
              onNone: () =>
                // Defect or empty cause
                new Response(
                  JSON.stringify({ error: "internal_error" }),
                  { status: 500, headers: { "Content-Type": "application/json" } }
                ),
              onSome: (error) =>
                // Use Match.tag for declarative error type matching
                Match.value(error).pipe(
                  Match.tag("RoomEventHandlerError", (err) =>
                    new Response(
                      JSON.stringify({
                        error: "event_handler_error",
                        operation: err.operation,
                        roomId: err.roomId
                      }),
                      { status: 500, headers: { "Content-Type": "application/json" } }
                    )
                  ),
                  Match.tag("EventJournalError", (err) =>
                    new Response(
                      JSON.stringify({
                        error: "journal_error",
                        method: err.method
                      }),
                      { status: 500, headers: { "Content-Type": "application/json" } }
                    )
                  ),
                  Match.exhaustive
                )
            })
          )
      })
    );
  }
}
