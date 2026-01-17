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
import { makeDoSqliteEventLogRuntimeLayer } from "./EventLogStorage";
import { decodeRoomEventEnvelopeMsgPack, payloadEncoders, type RoomEvent } from "../domain/RoomProtocol";
import { SqliteClient as DoSqliteClient } from "@effect/sql-sqlite-do";
import { layerConfig as DoSqliteNoTxLayerConfig } from "./db/DoSqliteClientNoTx";
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
  RoomInitializedPayload,
  TurnAcceptedPayload,
  TurnAdvancedPayload,
  ScoreUpdatedPayload,
  RoomCompletedPayload,
  RoomErrorPayload,
  PlayerJoinedPayload,
  PlayerDisconnectedPayload,
  RoomStatePersistence,
  TurnAcceptedIdempotency,
  SessionValidation,
  ValidatedSession,
  type RoomDomainContext
} from "../domain/index.js";
import { TurnQueueLive } from "../services/TurnQueue.js";
import { EventJournalError, RemoteId, Entry, makeEntryId } from "@effect/experimental/EventJournal";
import * as EventLogRemote from "@effect/experimental/EventLogRemote";
import * as EventLogServer from "@effect/experimental/EventLogServer";
import { PersistedEntry } from "@effect/experimental/EventLogServer";
import { EventLogEncryption, EncryptedRemoteEntry, layerSubtle as EventLogEncryptionLayer } from "@effect/experimental/EventLogEncryption";
import * as Redacted from "effect/Redacted";

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
// Room Identity Helper
// =============================================================================

/**
 * Create a deterministic identity for a room.
 * Uses SHA-256 of roomId to derive the private key, ensuring consistent
 * encryption/decryption across server and clients.
 */
const makeRoomIdentity = Effect.fn("RoomDurableObject.makeRoomIdentity")(function* (roomId: string) {
  const encryption = yield* EventLogEncryption;
  const key = yield* encryption.sha256(new TextEncoder().encode(roomId));
  return EventLog.Identity.of({
    publicKey: roomId,
    privateKey: Redacted.make(key)
  });
});

// =============================================================================
// Runtime Layer Construction
// =============================================================================

/**
 * Create a minimal SqlClient layer for schema migrations.
 * Used by blockConcurrencyWhile to apply schema BEFORE the full domain layer.
 */
const makeSqliteOnlyLayer = (storage: SqlStorage) =>
  DoSqliteClient.layerConfig(Config.succeed({ db: storage }));

/**
 * Create the full runtime layer for the room domain.
 * Includes EventLog, handlers, state persistence, SQL client, and TurnQueue.
 *
 * IMPORTANT: This layer uses DoSqliteNoTxLayerConfig which uses no-op transaction
 * commands (SELECT 1 instead of BEGIN/COMMIT/ROLLBACK). This is required because
 * Cloudflare DO SQLite doesn't support direct SQL transaction statements - it
 * requires using transactionSync() or transaction() methods instead.
 *
 * The schema migration must run BEFORE this layer is constructed, which is why
 * we use a separate SqlClient-only layer for applyRoomSchema.
 */
const makeRoomDomainLayer = (storage: SqlStorage, cloudflareEnv: CloudflareEnv) => {
  // Use no-tx client for domain layer since SqlEventJournal uses withTransaction
  const sqliteLayer = DoSqliteNoTxLayerConfig(Config.succeed({ db: storage }));
  const envLayer = Layer.succeed(Env, cloudflareEnv);
  const turnQueueLayer = TurnQueueLive.pipe(Layer.provide(envLayer));

  // Provide TurnQueue for AudioUploaded handler (Architecture Invariant #9)
  return RoomDomainLive.pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(turnQueueLayer)
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
 * Convert a RoomEvent to the payload format expected by MsgPack encoders.
 *
 * The inbound RoomEvent has a different shape than the server payload schemas:
 * - ScoreUpdated: client uses { evaluation }, encoder expects flat { roomId, scores, ... }
 * - RoomCompleted: client uses { summary }, encoder expects { roomId, summary, timestamp }
 * - RoomError: client type is "Error", encoder key is "RoomError", needs roomId + timestamp
 *
 * This function normalizes the event to match the encoder schema.
 *
 * @returns { eventType: string, payload: object } - The encoder key and matching payload
 */
const convertEventToEncoderPayload = (
  roomId: string,
  event: RoomEvent
): { eventType: string; payload: Record<string, unknown> } => {
  const timestamp = Date.now();

  switch (event.type) {
    case "ScoreUpdated":
      // Flatten evaluation object to match ScoreUpdatedPayloadSchema
      return {
        eventType: "ScoreUpdated",
        payload: {
          roomId,
          turnId: event.turnId,
          scores: event.evaluation.scores,
          overallScore: event.evaluation.overallScore,
          feedback: event.evaluation.feedback,
          nextPrompt: event.evaluation.nextPrompt,
          modelVersion: event.evaluation.modelVersion,
          confidence: event.evaluation.confidence
        }
      };

    case "RoomCompleted":
      // Add roomId and timestamp
      return {
        eventType: "RoomCompleted",
        payload: {
          roomId,
          summary: event.summary,
          timestamp
        }
      };

    case "Error":
      // Normalize type to "RoomError" and add roomId + timestamp
      return {
        eventType: "RoomError",
        payload: {
          roomId,
          code: event.code,
          message: event.message,
          retryable: event.retryable,
          timestamp
        }
      };

    default: {
      // Other events already match their encoder schemas (just strip the type)
      const { type: eventType, ...payloadWithoutType } = event;
      return { eventType, payload: payloadWithoutType };
    }
  }
};

/**
 * Convert legacy RoomEvent to domain event payloads.
 * This bridges the old protocol events to the new typed payloads.
 *
 * For TurnAccepted, also emits TurnAdvanced to advance the turn progression.
 * The idempotency check in the TurnAdvanced handler prevents double-advance on retry.
 */
const convertToPayload = Effect.fn("RoomDurableObject.convertToPayload")(function* (
  roomId: string,
  event: RoomEvent
) {
  const log = yield* EventLog.EventLog;
  const persistence = yield* RoomStatePersistence;
  const timestamp = Date.now();

  switch (event.type) {
    case "RoomInitialized": {
      yield* log.write({
        schema: RoomEventSchema,
        event: "RoomInitialized",
        payload: new RoomInitializedPayload({
          roomId: event.roomId,
          scenarioId: event.scenarioId,
          seedPrompt: event.seedPrompt,
          topic: event.topic,
          level: event.level,
          timestamp
        })
      });
      break;
    }

    case "TurnAccepted": {
      // Idempotency check: skip if this turnId was already accepted
      const turnIdempotency = yield* TurnAcceptedIdempotency;
      const alreadyAccepted = yield* turnIdempotency.hasAccepted(event.turnId);
      if (alreadyAccepted) {
        yield* Effect.logDebug(`TurnAccepted already processed for turnId ${event.turnId}, skipping`);
        break;
      }

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
          playerId: event.playerId,
          transcript: event.transcript,
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

      // Record idempotency AFTER EventLog writes succeed (P1-02 fix)
      // This ensures retries can proceed if writes fail
      // Architecture Invariant #3: no separate persist calls before atomic journal writes
      yield* turnIdempotency.recordAccepted(event.turnId, roomId);
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
          nextPrompt: event.evaluation.nextPrompt,
          modelVersion: event.evaluation.modelVersion,
          confidence: event.evaluation.confidence
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

/**
 * RoomDurableObject extends EventLogDurableObject which provides:
 * - Hibernatable WebSocket support (setHibernatableWebSocketEventTimeout)
 * - WebSocket lifecycle handlers (webSocketMessage, webSocketClose, webSocketError)
 * - EventLog protocol handling via acceptWebSocket()
 *
 * The DO hibernates between WebSocket messages to minimize duration billing.
 */
export class RoomDurableObject extends EventLogDurableObject {
  private readonly roomRuntime: ManagedRuntime.ManagedRuntime<RoomRuntimeContext, never>;
  /**
   * DO internal ID (used for logging only).
   * NOT the roomId used for EventLog identity - that comes from request path/envelope.
   */
  private readonly doId: string;

  constructor(state: DurableObjectState, env: CloudflareEnv) {
    const storage = (state.storage as DurableObjectStorage & { sql: SqlStorage }).sql;
    super({
      ctx: state,
      env,
      // Use runtime layer that includes EventLogEncryption for broadcast functionality
      storageLayer: makeDoSqliteEventLogRuntimeLayer(storage).pipe(Layer.orDie)
    });

    // Store DO internal ID for logging (NOT for EventLog identity!)
    this.doId = state.id.toString();

    // blockConcurrencyWhile ensures no requests are processed until schema is applied
    // CRITICAL: Apply schema using a MINIMAL SqlClient-only layer BEFORE creating
    // the full domain runtime. This prevents SqlEventLogServer from trying to
    // create/query tables before our schema tables exist.
    state.blockConcurrencyWhile(async () => {
      console.log("[RoomDO] Starting schema migration for DO:", this.doId);
      const schemaRuntime = ManagedRuntime.make(
        makeSqliteOnlyLayer(storage).pipe(Layer.orDie)
      );
      try {
        await schemaRuntime.runPromise(applyRoomSchema);
        console.log("[RoomDO] Schema migration completed for DO:", this.doId);
      } catch (e) {
        console.error("[RoomDO] Schema migration FAILED:", e);
        throw e;
      } finally {
        await schemaRuntime.dispose();
      }
    });

    // Create runtime with full domain layer AFTER schema is applied
    console.log("[RoomDO] Creating domain runtime for DO:", this.doId);
    this.roomRuntime = ManagedRuntime.make(
      makeRoomDomainLayer(storage, env).pipe(Layer.orDie)
    );
  }

  /**
   * Broadcast an event to all connected WebSocket clients.
   *
   * This bridges server-side EventLog.write() to WebSocket clients by:
   * 1. Encrypting the event using room identity
   * 2. Persisting to EventLogServer.Storage to get authoritative sequence numbers
   * 3. Encoding as EventLogRemote.Changes message
   * 4. Sending to all connected WebSockets
   *
   * CRITICAL: roomId must be the human-readable room name (e.g., "abc-123"),
   * NOT the DO's internal state.id. This ensures client and server derive
   * the same encryption identity for the EventLogRemote protocol.
   *
   * CRITICAL (P1-01): Entries MUST be persisted to EventLogServer.Storage so that:
   * - Sequences are assigned by storage (monotonic, persistent)
   * - RequestChanges can serve persisted entries on reconnect
   * - Clients can resync from their last known sequence
   *
   * Uses this.runtime (from EventLogDurableObject parent) which has
   * EventLogEncryption and EventLogServer.Storage services.
   *
   * @param roomId - The human-readable room name (from request path or event envelope)
   * @param event - The RoomEvent to broadcast
   */
  private broadcastEventToClients(roomId: string, event: RoomEvent): void {
    const webSockets = this.ctx.getWebSockets();

    // Always persist to storage even if no clients connected
    // This ensures replay works when clients reconnect
    console.log("[RoomDO] Broadcasting event:", event.type, "to", webSockets.length, "clients");

    this.runtime.runFork(
      Effect.gen(function* () {
        const encryption = yield* EventLogEncryption;
        const storage = yield* EventLogServer.Storage;
        const identity = yield* makeRoomIdentity(roomId);

        // Convert event to encoder-compatible payload format
        // This handles mismatches between client event shapes and server payload schemas:
        // - ScoreUpdated: flattens evaluation object + adds roomId
        // - RoomCompleted: adds roomId + timestamp
        // - RoomError: normalizes type from "Error" to "RoomError" + adds roomId + timestamp
        const { eventType, payload: payloadData } = convertEventToEncoderPayload(roomId, event);

        if (!(eventType in payloadEncoders)) {
          yield* Effect.logWarning(`No encoder for event type: ${eventType}, skipping broadcast`);
          return;
        }

        // Encode the normalized payload
        const encoder = (payloadEncoders as Record<string, (input: unknown) => Uint8Array>)[eventType]!;
        const payload = encoder(payloadData);

        const entry = new Entry({
          id: makeEntryId(),
          event: eventType,
          primaryKey: roomId,
          payload
        });

        // Encrypt the entry
        const encrypted = yield* encryption.encrypt(identity, [entry]);

        // Persist to storage to get authoritative sequence numbers
        // This is CRITICAL for P1-01: reconnect replay support
        // Storage.write() returns EncryptedRemoteEntry with proper sequences
        const persistedEntries = yield* storage.write(
          identity.publicKey,
          [
            new PersistedEntry({
              entryId: entry.id,
              iv: encrypted.iv,
              encryptedEntry: encrypted.encryptedEntries[0]!
            })
          ]
        );

        yield* Effect.logDebug("Persisted entry to storage", {
          eventType,
          entryCount: persistedEntries.length,
          sequences: persistedEntries.map((e) => e.sequence)
        });

        // Skip broadcast if no clients connected (but entry is already persisted)
        if (webSockets.length === 0) {
          yield* Effect.logDebug("No WebSocket clients connected, entry persisted for replay");
          return;
        }

        // Encode as Changes response using persisted entries (with storage-assigned sequences)
        const changes = EventLogRemote.encodeResponse(
          new EventLogRemote.Changes({
            publicKey: identity.publicKey,
            entries: persistedEntries
          })
        );

        // Send to all connected WebSockets
        for (const ws of webSockets) {
          yield* Effect.try({
            try: () => ws.send(changes),
            catch: () => undefined // Ignore send failures, log below
          }).pipe(
            Effect.tapError(() =>
              Effect.logWarning("Failed to send to WebSocket")
            ),
            Effect.ignore
          );
        }

        yield* Effect.logInfo("Broadcast complete", {
          eventType: event.type,
          clientCount: webSockets.length,
          sequences: persistedEntries.map((e) => e.sequence)
        });
      }).pipe(
        Effect.provide(EventLogEncryptionLayer),
        Effect.catchAllCause(Effect.logError)
      )
    );
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
    console.log("[RoomDO] Processing event:", envelope.event.type, "for room:", envelope.roomId);

    // Use EventLog.write() for atomic event + state persistence
    // This satisfies Invariant #3: Event append + projections are atomic
    const result = await this.roomRuntime.runPromiseExit(
      convertToPayload(envelope.roomId, envelope.event)
    );
    console.log("[RoomDO] Event processing result:", result._tag);

    // Handle success/failure with appropriate HTTP responses using Effect's Exit
    return pipe(
      result,
      Exit.match({
        onSuccess: () => {
          // Broadcast event to connected WebSocket clients
          // This bridges server-side EventLog.write() to the WebSocket sync protocol
          // CRITICAL: Use envelope.roomId (human-readable name), not DO state.id
          this.broadcastEventToClients(envelope.roomId, envelope.event);
          return new Response(null, { status: 204 });
        },
        onFailure: (cause) => {
          // Log the full cause for debugging
          console.error("[RoomDO] Event processing failure:", Cause.pretty(cause));
          return pipe(
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
          );
        }
      })
    );
  }

  /**
   * Extract roomId from WebSocket request URL path.
   * Path format: /api/rooms/:roomId/stream
   *
   * CRITICAL: This returns the human-readable room name, which must match
   * what clients use for EventLog identity derivation.
   */
  private extractRoomIdFromPath(request?: Request): string | null {
    if (!request) return null;
    try {
      const url = new URL(request.url);
      const pathParts = url.pathname.split("/").filter(Boolean);
      // Path: ["api", "rooms", ":roomId", "stream"]
      const roomsIndex = pathParts.indexOf("rooms");
      if (roomsIndex >= 0 && roomsIndex + 1 < pathParts.length) {
        return pathParts[roomsIndex + 1] ?? null;
      }
    } catch {
      // URL parsing failed
    }
    return null;
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
    // Extract roomId from URL path (human-readable name, NOT DO state.id)
    // CRITICAL: This must match what clients use for EventLog identity
    const roomId = this.extractRoomIdFromPath(request);
    if (!roomId) {
      return new Response(
        JSON.stringify({ error: "bad_request", message: "Could not extract roomId from URL path" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

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

    // Validate session token (roomId now comes from URL path, not DO state.id)
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
      // CRITICAL: Use attachment.roomId (human-readable name from URL), not DO state.id
      const roomId = attachment.roomId;
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
