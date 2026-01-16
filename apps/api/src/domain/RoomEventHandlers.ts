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
import {
  RoomEventGroup,
  RoomEventHandlerError,
  type TurnAcceptedPayload,
  type ScoreUpdatedPayload,
  type NpcTurnGeneratedPayload,
  type TurnAdvancedPayload,
  type PlayerJoinedPayload,
  type PlayerDisconnectedPayload,
  type RoomCompletedPayload,
  type RoomErrorPayload
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
      upsertState: (roomId: string, projection: RoomProjection) =>
        Effect.gen(function* () {
          const stateJson = JSON.stringify(Schema.encodeSync(RoomProjection)(projection));
          yield* sql`
            INSERT INTO room_state (room_id, state_json, updated_at)
            VALUES (${roomId}, ${stateJson}, ${projection.updatedAt})
            ON CONFLICT (room_id) DO UPDATE SET
              state_json = ${stateJson},
              updated_at = ${projection.updatedAt}
          `;
        }).pipe(
          Effect.mapError((cause) =>
            new RoomEventHandlerError({
              operation: "upsertState",
              roomId,
              cause
            })
          )
        ),

      getState: (roomId: string) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ state_json: string }>`
            SELECT state_json FROM room_state WHERE room_id = ${roomId}
          `;
          if (rows.length === 0) return null;
          return Schema.decodeUnknownSync(RoomProjection)(JSON.parse(rows[0]!.state_json));
        }).pipe(
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
const loadOrCreateState = (roomId: string, timestamp: number) =>
  Effect.gen(function* () {
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
      .handle("TurnAccepted", ({ payload, entry }) =>
        Effect.gen(function* () {
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
        })
      )
      .handle("ScoreUpdated", ({ payload, entry }) =>
        Effect.gen(function* () {
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
        })
      )
      .handle("NpcTurnGenerated", ({ payload, entry }) =>
        Effect.gen(function* () {
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
        })
      )
      .handle("TurnAdvanced", ({ payload, entry }) =>
        Effect.gen(function* () {
          const persistence = yield* RoomStatePersistence;
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

          yield* persistence.upsertState(payload.roomId, newState);
        })
      )
      .handle("PlayerJoined", ({ payload, entry }) =>
        Effect.gen(function* () {
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
        })
      )
      .handle("PlayerDisconnected", ({ payload, entry }) =>
        Effect.gen(function* () {
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
        })
      )
      .handle("RoomCompleted", ({ payload, entry }) =>
        Effect.gen(function* () {
          const persistence = yield* RoomStatePersistence;
          const current = yield* loadOrCreateState(payload.roomId, payload.timestamp);

          const newState = new RoomProjection({
            ...current,
            state: new CompleteState({ _tag: "Complete", summary: payload.summary }),
            lastEventId: entry.idString,
            updatedAt: payload.timestamp
          });

          yield* persistence.upsertState(payload.roomId, newState);
        })
      )
      .handle("RoomError", ({ payload, entry }) =>
        Effect.gen(function* () {
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
        })
      )
);
