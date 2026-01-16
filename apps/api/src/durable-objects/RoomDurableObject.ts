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
import { Env, type CloudflareEnv } from "../services/Env.js";
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
  PlayerJoinedPayload,
  PlayerDisconnectedPayload,
  RoomStatePersistence,
  SessionValidation,
  ValidatedSession,
  type RoomDomainContext
} from "../domain/index.js";
import { TurnQueueLive } from "../services/TurnQueue.js";
import { EventJournalError, RemoteId } from "@effect/experimental/EventJournal";
import * as EventLogRemote from "@effect/experimental/EventLogRemote";
import * as EventLogServer from "@effect/experimental/EventLogServer";

// =============================================================================
// WebSocket Session Attachment Type
// =============================================================================

/**
 * Data stored in WebSocket attachment for session tracking.
 * Uses serializeAttachment/deserializeAttachment for hibernation support.
 */
interface WebSocketSessionAttachment {
  sessionId: string;
  userId: string;
  roomId: string;
  connectedAt: number;
}

// =============================================================================
// Runtime Layer Construction
// =============================================================================

/**
 * Create the full runtime layer for the room domain.
 * Includes EventLog, handlers, state persistence, SQL client, and TurnQueue.
 *
 * The SqlClient is merged into the output so it's available for schema migrations.
 */
const makeRoomDomainLayer = (storage: SqlStorage, cloudflareEnv: CloudflareEnv) => {
  const sqliteLayer = DoSqliteClient.layerConfig(Config.succeed({ db: storage }));
  const envLayer = Layer.succeed(Env, cloudflareEnv);
  const turnQueueLayer = TurnQueueLive.pipe(Layer.provide(envLayer));

  // Merge SqlClient into output so it's available for applyRoomSchema
  // Also provide TurnQueue for AudioUploaded handler (Architecture Invariant #9)
  return Layer.mergeAll(
    RoomDomainLive.pipe(
      Layer.provide(sqliteLayer),
      Layer.provide(turnQueueLayer)
    ),
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
const convertToPayload = Effect.fn(function* (
  roomId: string,
  event: RoomEvent
) {
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
  private readonly roomId: string;

  constructor(state: DurableObjectState, env: CloudflareEnv) {
    const storage = (state.storage as DurableObjectStorage & { sql: SqlStorage }).sql;
    super({
      ctx: state,
      env,
      storageLayer: makeDoSqliteEventLogStorageLayer(storage).pipe(Layer.orDie)
    });

    // Store room ID from DO state
    this.roomId = state.id.toString();

    // Create runtime with full domain layer
    this.roomRuntime = ManagedRuntime.make(
      makeRoomDomainLayer(storage, env).pipe(Layer.orDie)
    );

    // blockConcurrencyWhile ensures no requests are processed until schema is applied
    state.blockConcurrencyWhile(async () => {
      await this.roomRuntime.runPromise(applyRoomSchema);
    });
  }

  /**
   * Handle fetch requests, including WebSocket upgrade with session validation.
   *
   * Architecture Invariant #7: WebSocket handlers validate session before processing.
   */
  override async fetch(request?: Request): Promise<Response> {
    // Schema is guaranteed ready by blockConcurrencyWhile in constructor

    // Handle WebSocket upgrade with session validation
    if (!request || request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request);
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

  /**
   * Handle WebSocket upgrade with session validation.
   *
   * Architecture Invariant #7: WebSocket handlers validate session before processing.
   * Architecture Invariant #8: Participant membership is tracked in state.
   *
   * Token is extracted from:
   * - URL query parameter: ?token=<token>
   * - Authorization header: Bearer <token>
   */
  private async handleWebSocketUpgrade(request?: Request): Promise<Response> {
    // Extract session token from request
    let token: string | null = null;

    if (request) {
      // Try URL query parameter first
      const url = new URL(request.url);
      token = url.searchParams.get("token");

      // Fall back to Authorization header
      if (!token) {
        const authHeader = request.headers.get("Authorization");
        if (authHeader?.startsWith("Bearer ")) {
          token = authHeader.slice(7);
        }
      }
    }

    // Validate session token
    const roomId = this.roomId;
    const validationResult = await this.roomRuntime.runPromiseExit(
      Effect.gen(function* () {
        const sessionValidation = yield* SessionValidation;

        // Use token or generate anonymous session for MVP
        const effectiveToken = token || `anonymous-${crypto.randomUUID()}`;
        const session = yield* sessionValidation.validateToken(effectiveToken, roomId);

        // Persist session to database
        yield* sessionValidation.createSession(session);

        return session;
      })
    );

    // Check validation result
    if (Exit.isFailure(validationResult)) {
      const cause = validationResult.cause;
      const errorMessage = pipe(
        Cause.failureOption(cause),
        Option.match({
          onNone: () => "Session validation failed",
          onSome: (err) => `Session validation failed: ${err.operation}`
        })
      );

      return new Response(
        JSON.stringify({ error: "unauthorized", message: errorMessage }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const session = Exit.isSuccess(validationResult) ? validationResult.value : null;
    if (!session) {
      return new Response(
        JSON.stringify({ error: "unauthorized", message: "Session validation returned null" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create WebSocket pair
    const { 0: client, 1: server } = new WebSocketPair();

    // Accept WebSocket with session attachment for hibernation support
    this.ctx.acceptWebSocket(server);

    // Store session data in WebSocket attachment (survives hibernation)
    const wsAttachment: WebSocketSessionAttachment = {
      sessionId: session.sessionId,
      userId: session.userId,
      roomId: roomId,
      connectedAt: session.connectedAt
    };
    server.serializeAttachment(wsAttachment);

    // Emit PlayerJoined event to track participant membership
    // Architecture Invariant #8: Participant membership tracked in state
    const sessionUserId = session.userId;
    const sessionSessionId = session.sessionId;
    this.roomRuntime.runFork(
      Effect.gen(function* () {
        const log = yield* EventLog.EventLog;
        yield* log.write({
          schema: RoomEventSchema,
          event: "PlayerJoined",
          payload: new PlayerJoinedPayload({
            roomId: roomId,
            playerId: sessionUserId,
            sessionId: sessionSessionId,
            timestamp: Date.now()
          })
        });
      }).pipe(Effect.catchAllCause(Effect.logError))
    );

    // Send Hello message with remote ID (EventLog protocol)
    this.runtime.runFork(
      Effect.gen(function* () {
        const storage = yield* EventLogServer.Storage;
        const remoteIdValue = yield* storage.getId;
        server.send(
          EventLogRemote.encodeResponse(
            new EventLogRemote.Hello({ remoteId: RemoteId.make(remoteIdValue) })
          )
        );
      }).pipe(Effect.catchAllCause(Effect.logError))
    );

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  /**
   * Handle WebSocket message with session validation.
   *
   * Architecture Invariant #7: WebSocket handlers validate session before processing.
   */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Retrieve session from WebSocket attachment
    const attachment = ws.deserializeAttachment() as WebSocketSessionAttachment | null;

    if (!attachment) {
      // No session attached - close with error
      this.roomRuntime.runFork(
        Effect.logWarning("WebSocket message received without session attachment").pipe(
          Effect.tap(() => Effect.sync(() => ws.close(4001, "Session required")))
        )
      );
      return;
    }

    // Touch session to update last active timestamp
    const sessionId = attachment.sessionId;
    this.roomRuntime.runFork(
      Effect.gen(function* () {
        const sessionValidation = yield* SessionValidation;
        yield* sessionValidation.touchSession(sessionId);
      }).pipe(Effect.catchAllCause(Effect.logDebug))
    );

    // Delegate to parent for EventLog protocol handling
    return super.webSocketMessage(ws, message);
  }

  /**
   * Handle WebSocket close with session cleanup.
   *
   * Architecture Invariant #8: Participant membership tracked in state.
   */
  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // Retrieve session from WebSocket attachment
    const attachment = ws.deserializeAttachment() as WebSocketSessionAttachment | null;

    if (attachment) {
      // Capture values for use in generator
      const roomId = this.roomId;
      const userId = attachment.userId;
      const sessionId = attachment.sessionId;

      // Emit PlayerDisconnected event and clean up session
      this.roomRuntime.runFork(
        Effect.gen(function* () {
          const log = yield* EventLog.EventLog;
          const sessionValidation = yield* SessionValidation;

          // Emit PlayerDisconnected event
          yield* log.write({
            schema: RoomEventSchema,
            event: "PlayerDisconnected",
            payload: new PlayerDisconnectedPayload({
              roomId: roomId,
              playerId: userId,
              sessionId: sessionId,
              timestamp: Date.now()
            })
          });

          // Delete session from database
          yield* sessionValidation.deleteSession(sessionId);

          yield* Effect.logInfo("WebSocket closed", { code, reason, sessionId: sessionId });
        }).pipe(Effect.catchAllCause(Effect.logError))
      );
    } else {
      // No session - just log
      this.roomRuntime.runFork(
        Effect.logWarning("WebSocket closed without session", { code, reason })
      );
    }
  }

  /**
   * Handle WebSocket error.
   */
  override webSocketError(ws: WebSocket, error: Error): void {
    const attachment = ws.deserializeAttachment() as WebSocketSessionAttachment | null;

    this.roomRuntime.runFork(
      Effect.logWarning("WebSocket error", {
        error: error.message,
        sessionId: attachment?.sessionId ?? "unknown"
      })
    );
  }
}
