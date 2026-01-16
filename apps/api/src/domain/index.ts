/**
 * Room Domain Module - Event-sourced room state management
 *
 * This module provides:
 * - RoomEventGroup: Event definitions for room state machine
 * - RoomEventHandlers: Handlers that project state from events
 * - RoomEventSchema: Schema for use with EventLog.write()
 *
 * @see docs/ARCHITECTURE.md - Invariant #1: EventLog is the single source of truth
 * @see docs/ARCHITECTURE.md - Invariant #3: Event append + projections are atomic
 */
import * as EventLog from "@effect/experimental/EventLog";
import { EventJournal } from "@effect/experimental/EventJournal";
import * as SqlEventJournal from "@effect/sql/SqlEventJournal";
import { Layer, Effect } from "effect";

// Re-export event group and types
export {
  RoomEventGroup,
  RoomEventHandlerError,
  TurnAcceptedPayload,
  ScoreUpdatedPayload,
  NpcTurnGeneratedPayload,
  TurnAdvancedPayload,
  PlayerJoinedPayload,
  PlayerDisconnectedPayload,
  RoomCompletedPayload,
  RoomErrorPayload
} from "./RoomEventGroup.js";

// Re-export handlers and state types
export {
  RoomEventHandlersLive,
  RoomStatePersistence,
  RoomStatePersistenceLive,
  StepAdvanceIdempotency,
  StepAdvanceIdempotencyLive,
  RoomProjection,
  ProjectedRoomState,
  AwaitingTurnState,
  ProcessingState,
  NpcPendingState,
  CompleteState,
  ParticipantPlayer,
  ParticipantNPC,
  ParticipantType,
  ParticipantSession,
  RoomParticipants
} from "./RoomEventHandlers.js";

import { RoomEventGroup } from "./RoomEventGroup.js";
import { RoomEventHandlersLive, RoomStatePersistenceLive, StepAdvanceIdempotencyLive } from "./RoomEventHandlers.js";

// =============================================================================
// EventLog Schema
// =============================================================================

/**
 * Schema for the room event log.
 * Use with EventLog.write() to emit events.
 *
 * @example
 * ```typescript
 * const log = yield* EventLog.EventLog;
 * yield* log.write({
 *   schema: RoomEventSchema,
 *   event: "TurnAccepted",
 *   payload: new TurnAcceptedPayload({ ... })
 * });
 * ```
 */
export const RoomEventSchema = EventLog.schema(RoomEventGroup);

// =============================================================================
// EventJournal Layer
// =============================================================================

/**
 * SQL-based EventJournal layer.
 * Requires SqlClient to be provided.
 *
 * Creates tables:
 * - effect_room_event_journal: Event entries
 * - effect_room_event_remotes: Remote sync tracking
 */
export const RoomEventJournalLive = Layer.effect(
  EventJournal,
  SqlEventJournal.make({
    entryTable: "effect_room_event_journal",
    remotesTable: "effect_room_event_remotes"
  })
);

// =============================================================================
// Identity Layer
// =============================================================================

/**
 * Provides a random identity for the EventLog.
 * In production, this should be derived from room ID or user credentials.
 */
export const RoomIdentityLive = Layer.sync(EventLog.Identity, () =>
  EventLog.Identity.makeRandom()
);

// =============================================================================
// Domain Layers
// =============================================================================

/**
 * Complete room domain layer with event handlers and state persistence.
 * Requires SqlClient to be provided.
 *
 * Provides:
 * - EventLog (for emitting events via write())
 * - EventJournal (for event storage)
 * - RoomStatePersistence (for reading state)
 * - Identity (for encryption)
 * - All event handler registrations
 *
 * Layer composition order:
 * 1. EventLog.layer requires handlers, journal, identity
 * 2. RoomEventHandlersLive provides handlers, requires RoomStatePersistence + StepAdvanceIdempotency
 * 3. RoomStatePersistenceLive requires SqlClient
 * 4. StepAdvanceIdempotencyLive requires SqlClient
 * 5. RoomEventJournalLive requires SqlClient
 *
 * @example
 * ```typescript
 * const runtime = ManagedRuntime.make(
 *   RoomDomainLive.pipe(
 *     Layer.provide(DoSqliteClient.layer(...))
 *   )
 * );
 * ```
 */
export const RoomDomainLive = EventLog.layer(RoomEventSchema).pipe(
  // EventLog.layer requires handlers + journal + identity
  Layer.provide(RoomEventHandlersLive),
  // Handlers require RoomStatePersistence + StepAdvanceIdempotency
  Layer.provide(RoomStatePersistenceLive),
  Layer.provide(StepAdvanceIdempotencyLive),
  // EventLog.layer requires EventJournal
  Layer.provide(RoomEventJournalLive),
  // EventLog.layer requires Identity
  Layer.provide(RoomIdentityLive),
  // Merge all services into a single layer
  Layer.provideMerge(RoomStatePersistenceLive)
);

/**
 * Type of the context provided by RoomDomainLive
 */
export type RoomDomainContext = Layer.Layer.Success<typeof RoomDomainLive>;

// =============================================================================
// Client API
// =============================================================================

/**
 * Create a typed client for emitting room events.
 *
 * @example
 * ```typescript
 * const emitRoomEvent = yield* makeRoomEventClient;
 * yield* emitRoomEvent("TurnAccepted", new TurnAcceptedPayload({ ... }));
 * ```
 */
export const makeRoomEventClient = EventLog.makeClient(RoomEventSchema);

// =============================================================================
// Event History API
// =============================================================================

/**
 * Get all events from the event journal.
 * Used for replaying events and reconstructing state.
 *
 * @see docs/ARCHITECTURE.md - Invariant #1: EventLog is the single source of truth
 */
export const getEventHistory = Effect.gen(function* () {
  const log = yield* EventLog.EventLog;
  return yield* log.entries;
});
