/**
 * RoomEventHandlers - Event handlers that project room state
 *
 * These handlers are called atomically with event persistence via EventLog.write().
 * Each handler receives the event payload and projects it into room state.
 *
 * @see docs/ARCHITECTURE.md - Invariant #3: Event append + projections are atomic
 */
import { Effect, Layer, Context } from "effect";
import * as Schema from "effect/Schema";
import { EventLog } from "@effect/experimental";
import { SqlClient } from "@effect/sql";
import { TurnQueue } from "../services/TurnQueue.js";
import {
  RoomEventGroup,
  RoomEventHandlerError,
  type RoomInitializedPayload,
  type TurnAcceptedPayload,
  type ScoreUpdatedPayload,
  type NpcTurnGeneratedPayload,
  type TurnAdvancedPayload,
  type PlayerJoinedPayload,
  type PlayerDisconnectedPayload,
  type RoomCompletedPayload,
  type RoomErrorPayload,
  type AudioUploadedPayload
} from "./RoomEventGroup.js";

// =============================================================================
// Projected Room State (derived from events)
// =============================================================================

export class ParticipantPlayer extends Schema.Class<ParticipantPlayer>("ParticipantPlayer")({
  _tag: Schema.Literal("Player"),
  playerId: Schema.String
}) {}

export class ParticipantNPC extends Schema.Class<ParticipantNPC>("ParticipantNPC")({
  _tag: Schema.Literal("NPC"),
  npcId: Schema.String,
  role: Schema.String
}) {}

export const ParticipantType = Schema.Union(ParticipantPlayer, ParticipantNPC);
export type ParticipantType = Schema.Schema.Type<typeof ParticipantType>;

export class AwaitingTurnState extends Schema.Class<AwaitingTurnState>("AwaitingTurnState")({
  _tag: Schema.Literal("AwaitingTurn"),
  participant: ParticipantType,
  stepIndex: Schema.Number
}) {}

export class ProcessingState extends Schema.Class<ProcessingState>("ProcessingState")({
  _tag: Schema.Literal("Processing"),
  turnId: Schema.String,
  participant: ParticipantType
}) {}

export class NpcPendingState extends Schema.Class<NpcPendingState>("NpcPendingState")({
  _tag: Schema.Literal("NpcPending"),
  npcId: Schema.String,
  stepIndex: Schema.Number,
  scheduledAt: Schema.Number
}) {}

export class CompleteState extends Schema.Class<CompleteState>("CompleteState")({
  _tag: Schema.Literal("Complete"),
  summary: Schema.optional(Schema.String)
}) {}

export const ProjectedRoomState = Schema.Union(
  AwaitingTurnState,
  ProcessingState,
  NpcPendingState,
  CompleteState
);

export type ProjectedRoomState = Schema.Schema.Type<typeof ProjectedRoomState>;

// =============================================================================
// Room Participants (tracked separately)
// =============================================================================

export class ParticipantSession extends Schema.Class<ParticipantSession>("ParticipantSession")({
  playerId: Schema.String,
  sessionId: Schema.String,
  connectedAt: Schema.Number,
  isConnected: Schema.Boolean
}) {}

export class RoomParticipants extends Schema.Class<RoomParticipants>("RoomParticipants")({
  roomId: Schema.String,
  sessions: Schema.Array(ParticipantSession)
}) {}

// =============================================================================
// Full Room Projection (state + participants + metadata)
// =============================================================================

export class RoomProjection extends Schema.Class<RoomProjection>("RoomProjection")({
  roomId: Schema.String,
  state: ProjectedRoomState,
  participants: RoomParticipants,
  currentStepIndex: Schema.Number,
  lastEventId: Schema.optional(Schema.String),
  updatedAt: Schema.Number
}) {}

// =============================================================================
// Step Advance Idempotency Service
// =============================================================================

/**
 * Service to ensure step advances are idempotent.
 * Prevents double-advance on retry (Architecture Invariant #5).
 */
export class StepAdvanceIdempotency extends Context.Tag("StepAdvanceIdempotency")<
  StepAdvanceIdempotency,
  {
    /**
     * Check if an advance from this step has already been recorded.
     * Returns true if already advanced (should skip), false if not yet advanced.
     */
    readonly hasAdvanced: (roomId: string, fromStepIndex: number) => Effect.Effect<boolean, RoomEventHandlerError>;
    /**
     * Record that an advance from this step has occurred.
     * Should be called atomically with the state update.
     */
    readonly recordAdvance: (roomId: string, fromStepIndex: number, toStepIndex: number) => Effect.Effect<void, RoomEventHandlerError>;
  }
>() {}

/**
 * SQL-based step advance idempotency using room_step_advances table.
 */
export const StepAdvanceIdempotencyLive = Layer.effect(
  StepAdvanceIdempotency,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return {
      hasAdvanced: (roomId: string, fromStepIndex: number) =>
        sql<{ room_id: string }>`
          SELECT room_id FROM room_step_advances
          WHERE room_id = ${roomId} AND from_step_index = ${fromStepIndex}
        `.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "hasAdvanced",
              roomId,
              cause
            })
          )
        ),

      recordAdvance: (roomId: string, fromStepIndex: number, toStepIndex: number) =>
        sql`
          INSERT INTO room_step_advances (room_id, from_step_index, to_step_index, advanced_at)
          VALUES (${roomId}, ${fromStepIndex}, ${toStepIndex}, ${Date.now()})
        `.pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "recordAdvance",
              roomId,
              cause
            })
          )
        )
    };
  })
);

// =============================================================================
// Alarm Idempotency Service
// =============================================================================

/**
 * Service to ensure alarm-triggered NPC turns are idempotent.
 * Prevents duplicate NPC turn generation on alarm retry (Architecture Invariant #6).
 * DO alarms can fire up to 7 times with at-least-once semantics.
 */
export class AlarmIdempotency extends Context.Tag("AlarmIdempotency")<
  AlarmIdempotency,
  {
    /**
     * Check if an alarm for this NPC/step has already been processed.
     * Returns the existing turnId if already processed, null otherwise.
     */
    readonly getProcessedTurnId: (
      npcId: string,
      stepIndex: number,
      scheduledAt: number
    ) => Effect.Effect<string | null, RoomEventHandlerError>;
    /**
     * Record that an alarm has been processed and generated a turn.
     * Should be called before generating the NPC turn.
     */
    readonly recordAlarmProcessed: (
      npcId: string,
      stepIndex: number,
      scheduledAt: number,
      turnId: string
    ) => Effect.Effect<void, RoomEventHandlerError>;
  }
>() {}

/**
 * SQL-based alarm idempotency using alarm_processing table.
 */
export const AlarmIdempotencyLive = Layer.effect(
  AlarmIdempotency,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return {
      getProcessedTurnId: (npcId: string, stepIndex: number, scheduledAt: number) =>
        sql<{ turn_id: string }>`
          SELECT turn_id FROM alarm_processing
          WHERE npc_id = ${npcId} AND step_index = ${stepIndex} AND scheduled_at = ${scheduledAt}
        `.pipe(
          Effect.map((rows) => rows.length > 0 ? rows[0]!.turn_id : null),
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "getProcessedTurnId",
              roomId: npcId,
              cause
            })
          )
        ),

      recordAlarmProcessed: (npcId: string, stepIndex: number, scheduledAt: number, turnId: string) =>
        sql`
          INSERT INTO alarm_processing (npc_id, step_index, scheduled_at, turn_id, processed_at)
          VALUES (${npcId}, ${stepIndex}, ${scheduledAt}, ${turnId}, ${Date.now()})
        `.pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "recordAlarmProcessed",
              roomId: npcId,
              cause
            })
          )
        )
    };
  })
);

// =============================================================================
// TurnAccepted Idempotency Service
// =============================================================================

/**
 * Service to ensure TurnAccepted events are idempotent.
 * Prevents duplicate TurnAccepted writes on HTTP retry.
 */
export class TurnAcceptedIdempotency extends Context.Tag("TurnAcceptedIdempotency")<
  TurnAcceptedIdempotency,
  {
    /**
     * Check if TurnAccepted has already been processed for this turnId.
     * Returns true if already processed (should skip), false otherwise.
     */
    readonly hasAccepted: (turnId: string) => Effect.Effect<boolean, RoomEventHandlerError>;
    /**
     * Record that TurnAccepted has been processed for this turnId.
     * Should be called atomically with the EventLog write.
     */
    readonly recordAccepted: (turnId: string, roomId: string) => Effect.Effect<void, RoomEventHandlerError>;
  }
>() {}

/**
 * SQL-based TurnAccepted idempotency using turn_accepted_idempotency table.
 */
export const TurnAcceptedIdempotencyLive = Layer.effect(
  TurnAcceptedIdempotency,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return {
      hasAccepted: (turnId: string) =>
        sql<{ turn_id: string }>`
          SELECT turn_id FROM turn_accepted_idempotency
          WHERE turn_id = ${turnId}
        `.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "hasAccepted",
              roomId: turnId,
              cause
            })
          )
        ),

      recordAccepted: (turnId: string, roomId: string) =>
        sql`
          INSERT INTO turn_accepted_idempotency (turn_id, room_id, accepted_at)
          VALUES (${turnId}, ${roomId}, ${Date.now()})
        `.pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "recordAccepted",
              roomId,
              cause
            })
          )
        )
    };
  })
);

// =============================================================================
// Session Validation Service (Architecture Invariants #7, #8)
// =============================================================================

/**
 * Validated session data for a connected WebSocket.
 */
export class ValidatedSession extends Schema.Class<ValidatedSession>("ValidatedSession")({
  sessionId: Schema.String,
  userId: Schema.String,
  roomId: Schema.String,
  connectedAt: Schema.Number,
  lastActiveAt: Schema.Number,
  metadata: Schema.optional(Schema.Unknown)
}) {}

/**
 * Service to validate WebSocket sessions and track participant membership.
 * Implements Architecture Invariants #7 (WebSocket handlers validate session)
 * and #8 (participant membership tracked in state).
 */
export class SessionValidation extends Context.Tag("SessionValidation")<
  SessionValidation,
  {
    /**
     * Validate a session token and extract user identity.
     * For MVP, accepts any token and extracts userId from it.
     * In production, this would verify JWTs or session tokens.
     */
    readonly validateToken: (
      token: string,
      roomId: string
    ) => Effect.Effect<ValidatedSession, RoomEventHandlerError>;

    /**
     * Create a new session record when WebSocket connects.
     */
    readonly createSession: (
      session: ValidatedSession
    ) => Effect.Effect<void, RoomEventHandlerError>;

    /**
     * Get an existing session by ID.
     */
    readonly getSession: (
      sessionId: string
    ) => Effect.Effect<ValidatedSession | null, RoomEventHandlerError>;

    /**
     * Update session's last active timestamp.
     */
    readonly touchSession: (
      sessionId: string
    ) => Effect.Effect<void, RoomEventHandlerError>;

    /**
     * Delete session when WebSocket disconnects.
     */
    readonly deleteSession: (
      sessionId: string
    ) => Effect.Effect<void, RoomEventHandlerError>;

    /**
     * Get all active sessions for a room.
     */
    readonly getSessionsForRoom: (
      roomId: string
    ) => Effect.Effect<ReadonlyArray<ValidatedSession>, RoomEventHandlerError>;
  }
>() {}

/**
 * SQL-based session validation using participant_sessions table.
 */
export const SessionValidationLive = Layer.effect(
  SessionValidation,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return {
      validateToken: (token: string, roomId: string) =>
        Effect.sync(() => {
          // MVP: Parse token as "userId:sessionId" or just use as userId
          // Production: Verify JWT signature and claims
          const now = Date.now();
          const [userId, providedSessionId] = token.includes(":")
            ? token.split(":")
            : [token, crypto.randomUUID()];

          const sessionId = providedSessionId || crypto.randomUUID();

          return new ValidatedSession({
            sessionId,
            userId: userId || "anonymous",
            roomId,
            connectedAt: now,
            lastActiveAt: now
          });
        }),

      createSession: (session: ValidatedSession) => {
        const metadataJson = session.metadata ? JSON.stringify(session.metadata) : null;
        return sql`
          INSERT INTO participant_sessions (session_id, room_id, user_id, connected_at, last_active_at, metadata_json)
          VALUES (${session.sessionId}, ${session.roomId}, ${session.userId}, ${session.connectedAt}, ${session.lastActiveAt}, ${metadataJson})
          ON CONFLICT (session_id) DO UPDATE SET
            last_active_at = ${session.lastActiveAt},
            room_id = ${session.roomId}
        `.pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "createSession",
              roomId: session.roomId,
              cause
            })
          )
        );
      },

      getSession: (sessionId: string) =>
        sql<{
          session_id: string;
          room_id: string;
          user_id: string;
          connected_at: number;
          last_active_at: number;
          metadata_json: string | null;
        }>`
          SELECT session_id, room_id, user_id, connected_at, last_active_at, metadata_json
          FROM participant_sessions
          WHERE session_id = ${sessionId}
        `.pipe(
          Effect.map((rows) => {
            if (rows.length === 0) return null;
            const row = rows[0]!;
            return new ValidatedSession({
              sessionId: row.session_id,
              userId: row.user_id,
              roomId: row.room_id,
              connectedAt: row.connected_at,
              lastActiveAt: row.last_active_at,
              metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined
            });
          }),
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "getSession",
              roomId: sessionId,
              cause
            })
          )
        ),

      touchSession: (sessionId: string) =>
        sql`
          UPDATE participant_sessions
          SET last_active_at = ${Date.now()}
          WHERE session_id = ${sessionId}
        `.pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "touchSession",
              roomId: sessionId,
              cause
            })
          )
        ),

      deleteSession: (sessionId: string) =>
        sql`
          DELETE FROM participant_sessions
          WHERE session_id = ${sessionId}
        `.pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "deleteSession",
              roomId: sessionId,
              cause
            })
          )
        ),

      getSessionsForRoom: (roomId: string) =>
        sql<{
          session_id: string;
          room_id: string;
          user_id: string;
          connected_at: number;
          last_active_at: number;
          metadata_json: string | null;
        }>`
          SELECT session_id, room_id, user_id, connected_at, last_active_at, metadata_json
          FROM participant_sessions
          WHERE room_id = ${roomId}
        `.pipe(
          Effect.map((rows) => rows.map(row => new ValidatedSession({
            sessionId: row.session_id,
            userId: row.user_id,
            roomId: row.room_id,
            connectedAt: row.connected_at,
            lastActiveAt: row.last_active_at,
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined
          }))),
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "getSessionsForRoom",
              roomId,
              cause
            })
          )
        )
    };
  })
);

// =============================================================================
// Audio Scoring Idempotency Service (Architecture Invariant #9)
// =============================================================================

/**
 * Service to ensure scoring enqueue from AudioUploaded is idempotent.
 * Prevents duplicate scoring jobs on event replay.
 */
export class AudioScoringIdempotency extends Context.Tag("AudioScoringIdempotency")<
  AudioScoringIdempotency,
  {
    /**
     * Check if scoring has already been enqueued for this turn.
     * Returns true if already enqueued (should skip), false otherwise.
     */
    readonly hasEnqueued: (turnId: string) => Effect.Effect<boolean, RoomEventHandlerError>;
    /**
     * Record that scoring has been enqueued for this turn.
     * Should be called BEFORE enqueuing to ensure idempotency.
     */
    readonly recordEnqueued: (turnId: string, audioKey: string) => Effect.Effect<void, RoomEventHandlerError>;
  }
>() {}

/**
 * SQL-based audio scoring idempotency using audio_scoring_enqueued table.
 */
export const AudioScoringIdempotencyLive = Layer.effect(
  AudioScoringIdempotency,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return {
      hasEnqueued: (turnId: string) =>
        sql<{ turn_id: string }>`
          SELECT turn_id FROM audio_scoring_enqueued
          WHERE turn_id = ${turnId}
        `.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "hasEnqueued",
              roomId: turnId,
              cause
            })
          )
        ),

      recordEnqueued: (turnId: string, audioKey: string) =>
        sql`
          INSERT INTO audio_scoring_enqueued (turn_id, audio_key, enqueued_at)
          VALUES (${turnId}, ${audioKey}, ${Date.now()})
        `.pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "recordEnqueued",
              roomId: turnId,
              cause
            })
          )
        )
    };
  })
);

// =============================================================================
// State Persistence Service
// =============================================================================

export class RoomStatePersistence extends Context.Tag("RoomStatePersistence")<
  RoomStatePersistence,
  {
    readonly upsertState: (roomId: string, projection: RoomProjection) => Effect.Effect<void, RoomEventHandlerError>;
    readonly getState: (roomId: string) => Effect.Effect<RoomProjection | null, RoomEventHandlerError>;
  }
>() {}

/**
 * SQL-based state persistence that runs atomically with event writes.
 *
 * Errors are wrapped in RoomEventHandlerError for proper propagation
 * through the event handling pipeline.
 */
export const RoomStatePersistenceLive = Layer.effect(
  RoomStatePersistence,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return {
      upsertState: (roomId: string, projection: RoomProjection) => {
        const stateJson = JSON.stringify(Schema.encodeSync(RoomProjection)(projection));
        return sql`
          INSERT INTO room_state (room_id, state_json, updated_at)
          VALUES (${roomId}, ${stateJson}, ${projection.updatedAt})
          ON CONFLICT (room_id) DO UPDATE SET
            state_json = ${stateJson},
            updated_at = ${projection.updatedAt}
        `.pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "upsertState",
              roomId,
              cause
            })
          )
        );
      },

      getState: (roomId: string) =>
        sql<{ state_json: string }>`
          SELECT state_json FROM room_state WHERE room_id = ${roomId}
        `.pipe(
          Effect.map((rows) => {
            if (rows.length === 0) return null;
            return Schema.decodeUnknownSync(RoomProjection)(JSON.parse(rows[0]!.state_json));
          }),
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "getState",
              roomId,
              cause
            })
          )
        )
    };
  })
);

// =============================================================================
// Event Handlers - Project events to state
// =============================================================================

/**
 * Helper to load current state or create initial state
 */
const loadOrCreateState = Effect.fn("RoomEventHandlers.loadOrCreateState")(function* (roomId: string, timestamp: number) {
  const persistence = yield* RoomStatePersistence;
  const existing = yield* persistence.getState(roomId);
  if (existing) return existing;

  // Create initial state
  return new RoomProjection({
    roomId,
    state: new AwaitingTurnState({
      _tag: "AwaitingTurn",
      participant: new ParticipantPlayer({ _tag: "Player", playerId: "" }),
      stepIndex: 0
    }),
    participants: new RoomParticipants({ roomId, sessions: [] }),
    currentStepIndex: 0,
    updatedAt: timestamp
  });
});

/**
 * RoomEventHandlersLive - Event handlers that project state atomically
 *
 * Each handler:
 * 1. Loads current state
 * 2. Applies the event to derive new state
 * 3. Persists the new state (atomic with event write)
 */
export const RoomEventHandlersLive = EventLog.group(
  RoomEventGroup,
  (handlers) =>
    handlers
      .handle("RoomInitialized", Effect.fn("RoomEventHandlers.RoomInitialized")(function* ({ payload, entry }) {
        const persistence = yield* RoomStatePersistence;

        // Idempotency: Check if state already exists (handles retry after DO emit failure)
        // This is the atomicity gap recovery pattern from uploadTurnAudio
        const existing = yield* persistence.getState(payload.roomId);
        if (existing) {
          yield* Effect.logDebug(`RoomInitialized already processed for room ${payload.roomId}, skipping`);
          return;
        }

        // RoomInitialized creates initial room state
        // NOTE: Room metadata (seedPrompt, topic, level) stays in event, NOT in RoomProjection
        const newState = new RoomProjection({
          roomId: payload.roomId,
          state: new AwaitingTurnState({
            _tag: "AwaitingTurn",
            participant: new ParticipantPlayer({ _tag: "Player", playerId: "" }),
            stepIndex: 0
          }),
          participants: new RoomParticipants({ roomId: payload.roomId, sessions: [] }),
          currentStepIndex: 0,
          lastEventId: entry.idString,
          updatedAt: payload.timestamp
        });

        yield* persistence.upsertState(payload.roomId, newState);
      }))
      .handle("TurnAccepted", Effect.fn("RoomEventHandlers.TurnAccepted")(function* ({ payload, entry }) {
        const persistence = yield* RoomStatePersistence;
        const current = yield* loadOrCreateState(payload.roomId, payload.timestamp);

        // Project: TurnAccepted -> Processing state
        const newState = new RoomProjection({
          ...current,
          state: new ProcessingState({
            _tag: "Processing",
            turnId: payload.turnId,
            participant: new ParticipantPlayer({ _tag: "Player", playerId: payload.playerId })
          }),
          lastEventId: entry.idString,
          updatedAt: payload.timestamp
        });

        yield* persistence.upsertState(payload.roomId, newState);
      }))
      .handle("ScoreUpdated", Effect.fn("RoomEventHandlers.ScoreUpdated")(function* ({ payload, entry }) {
        const persistence = yield* RoomStatePersistence;
        const current = yield* loadOrCreateState(payload.roomId, Date.now());

        // ScoreUpdated doesn't change room state (scoring is decoupled)
        // Just update lastEventId for tracking
        const newState = new RoomProjection({
          ...current,
          lastEventId: entry.idString,
          updatedAt: Date.now()
        });

        yield* persistence.upsertState(payload.roomId, newState);
      }))
      .handle("NpcTurnGenerated", Effect.fn("RoomEventHandlers.NpcTurnGenerated")(function* ({ payload, entry }) {
        const persistence = yield* RoomStatePersistence;
        const current = yield* loadOrCreateState(payload.roomId, payload.timestamp);

        // Project: NpcTurnGenerated -> Processing (NPC's turn was generated)
        const newState = new RoomProjection({
          ...current,
          state: new ProcessingState({
            _tag: "Processing",
            turnId: payload.turnId,
            participant: new ParticipantNPC({ _tag: "NPC", npcId: payload.npcId, role: "narrator" })
          }),
          lastEventId: entry.idString,
          updatedAt: payload.timestamp
        });

        yield* persistence.upsertState(payload.roomId, newState);
      }))
      .handle("TurnAdvanced", Effect.fn("RoomEventHandlers.TurnAdvanced")(function* ({ payload, entry }) {
        const persistence = yield* RoomStatePersistence;
        const idempotency = yield* StepAdvanceIdempotency;

        // Idempotency check: skip if already advanced from this step
        // Prevents double-advance on retry (Architecture Invariant #5)
        const alreadyAdvanced = yield* idempotency.hasAdvanced(payload.roomId, payload.fromStepIndex);
        if (alreadyAdvanced) {
          yield* Effect.logDebug(`Skipping duplicate TurnAdvanced for room ${payload.roomId} from step ${payload.fromStepIndex}`);
          return;
        }

        const current = yield* loadOrCreateState(payload.roomId, Date.now());

        // Project: TurnAdvanced -> AwaitingTurn or NpcPending
        const nextParticipant: ParticipantType =
          payload.nextParticipantType === "Player"
            ? new ParticipantPlayer({ _tag: "Player", playerId: payload.nextParticipantId })
            : new ParticipantNPC({ _tag: "NPC", npcId: payload.nextParticipantId, role: "narrator" });

        const newState = new RoomProjection({
          ...current,
          state: payload.nextParticipantType === "NPC"
            ? new NpcPendingState({
                _tag: "NpcPending",
                npcId: payload.nextParticipantId,
                stepIndex: payload.toStepIndex,
                scheduledAt: Date.now()
              })
            : new AwaitingTurnState({
                _tag: "AwaitingTurn",
                participant: nextParticipant,
                stepIndex: payload.toStepIndex
              }),
          currentStepIndex: payload.toStepIndex,
          lastEventId: entry.idString,
          updatedAt: Date.now()
        });

        // Record advance and persist state atomically
        yield* idempotency.recordAdvance(payload.roomId, payload.fromStepIndex, payload.toStepIndex);
        yield* persistence.upsertState(payload.roomId, newState);
      }))
      .handle("PlayerJoined", Effect.fn("RoomEventHandlers.PlayerJoined")(function* ({ payload, entry }) {
        const persistence = yield* RoomStatePersistence;
        const current = yield* loadOrCreateState(payload.roomId, payload.timestamp);

        // Add player to participants
        const newSession = new ParticipantSession({
          playerId: payload.playerId,
          sessionId: payload.sessionId,
          connectedAt: payload.timestamp,
          isConnected: true
        });

        const newState = new RoomProjection({
          ...current,
          participants: new RoomParticipants({
            roomId: payload.roomId,
            sessions: [...current.participants.sessions, newSession]
          }),
          lastEventId: entry.idString,
          updatedAt: payload.timestamp
        });

        yield* persistence.upsertState(payload.roomId, newState);
      }))
      .handle("PlayerDisconnected", Effect.fn("RoomEventHandlers.PlayerDisconnected")(function* ({ payload, entry }) {
        const persistence = yield* RoomStatePersistence;
        const current = yield* loadOrCreateState(payload.roomId, payload.timestamp);

        // Mark player as disconnected
        const updatedSessions = current.participants.sessions.map((s) =>
          s.sessionId === payload.sessionId
            ? new ParticipantSession({ ...s, isConnected: false })
            : s
        );

        const newState = new RoomProjection({
          ...current,
          participants: new RoomParticipants({
            roomId: payload.roomId,
            sessions: updatedSessions
          }),
          lastEventId: entry.idString,
          updatedAt: payload.timestamp
        });

        yield* persistence.upsertState(payload.roomId, newState);
      }))
      .handle("RoomCompleted", Effect.fn("RoomEventHandlers.RoomCompleted")(function* ({ payload, entry }) {
        const persistence = yield* RoomStatePersistence;
        const current = yield* loadOrCreateState(payload.roomId, payload.timestamp);

        const newState = new RoomProjection({
          ...current,
          state: new CompleteState({ _tag: "Complete", summary: payload.summary }),
          lastEventId: entry.idString,
          updatedAt: payload.timestamp
        });

        yield* persistence.upsertState(payload.roomId, newState);
      }))
      .handle("RoomError", Effect.fn("RoomEventHandlers.RoomError")(function* ({ payload, entry }) {
        const persistence = yield* RoomStatePersistence;
        const current = yield* loadOrCreateState(payload.roomId, payload.timestamp);

        // RoomError is logged but doesn't change state machine
        // Could add error state if needed
        const newState = new RoomProjection({
          ...current,
          lastEventId: entry.idString,
          updatedAt: payload.timestamp
        });

        yield* persistence.upsertState(payload.roomId, newState);
      }))
      .handle("AudioUploaded", Effect.fn("RoomEventHandlers.AudioUploaded")(function* ({ payload, entry }) {
        const persistence = yield* RoomStatePersistence;
        const idempotency = yield* AudioScoringIdempotency;
        const queue = yield* TurnQueue;
        const current = yield* loadOrCreateState(payload.roomId, payload.timestamp);

        // Idempotency check: skip if scoring already enqueued for this turn
        // @see docs/ARCHITECTURE.md - Invariant #9: Scoring gated on AudioUploaded
        const alreadyEnqueued = yield* idempotency.hasEnqueued(payload.turnId);
        if (alreadyEnqueued) {
          yield* Effect.logDebug(`Skipping duplicate scoring enqueue for turn ${payload.turnId}`);
          // Still update state projection
          const newState = new RoomProjection({
            ...current,
            lastEventId: entry.idString,
            updatedAt: payload.timestamp
          });
          yield* persistence.upsertState(payload.roomId, newState);
          return;
        }

        // Enqueue scoring FIRST, then record idempotency on success
        // This ensures retry is possible if enqueue fails
        // CF Queues are durable - once enqueued, message is guaranteed
        const enqueueResult = yield* queue.enqueueTurn({
          roomId: payload.roomId,
          turnId: payload.turnId,
          status: "ready" // Audio exists, ready for scoring
        }).pipe(
          Effect.tapError((e) =>
            Effect.logError(`Queue enqueue failed for turn ${payload.turnId}`, e)
          ),
          Effect.either // Convert to Either so we can handle failure without failing handler
        );

        // Only record idempotency if enqueue succeeded
        // If enqueue failed, retry will be allowed (no idempotency record)
        if (enqueueResult._tag === "Right") {
          yield* idempotency.recordEnqueued(payload.turnId, payload.audioKey);
        } else {
          yield* Effect.logWarning(
            `Scoring enqueue failed for turn ${payload.turnId}, retry will be allowed`,
            { error: enqueueResult.left }
          );
        }

        // Update state projection
        const newState = new RoomProjection({
          ...current,
          lastEventId: entry.idString,
          updatedAt: payload.timestamp
        });

        yield* persistence.upsertState(payload.roomId, newState);
      }))
);
