import { Atom } from "@effect-atom/atom-react";
import { Effect, Stream } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { RoomEvent } from "../../shared/src/RoomProtocol";
import {
  getRoomEventStream,
  getRoomConnectionStatus,
  clearRoomConnection,
  initialConnectionState,
  type ConnectionState,
  type ConnectionStatus
} from "./EventLogClient";
import {
  initialRoomState,
  reduceRoomEvent,
  deriveScorePanelState,
  type RoomState,
  type ScorePanelState
} from "./RoomEventReducer";

// Re-export connection types for convenience
export type { ConnectionState, ConnectionStatus } from "./EventLogClient";
export { initialConnectionState, clearRoomConnection } from "./EventLogClient";

// =============================================================================
// Room ID Atom
// =============================================================================

export const roomIdAtom = Atom.searchParam("roomId", { schema: Schema.String });

// =============================================================================
// Event Stream (Shared Connection)
// =============================================================================

/**
 * Raw room event stream atom.
 * Emits individual RoomEvent objects as they arrive.
 *
 * Uses shared connection via getRoomEventStream - all atoms consuming
 * events for the same roomId share a single WebSocket connection.
 */
export const roomEventsAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  if (Option.isNone(roomId) || roomId.value.trim() === "") {
    return Stream.empty;
  }
  return getRoomEventStream(roomId.value);
});

// =============================================================================
// Room State Projection
// =============================================================================

/**
 * Project event stream into RoomState using Stream.scan.
 *
 * This is the correct client-side pattern for event projection.
 * Events are accumulated into state, preserving the full room context
 * including history, participants, and completion status.
 *
 * @see docs/ARCHITECTURE.md - Invariant #1: EventLog is the single source of truth
 */
export const roomStateStreamFromEvents = (
  events: Stream.Stream<RoomEvent>,
  initial: RoomState
): Stream.Stream<RoomState> => Stream.scan(events, initial, reduceRoomEvent);

/**
 * Full room state atom.
 * Projects all events into complete room state including:
 * - Room identity and status
 * - Turn progress and history
 * - Current turn scoring
 * - Error and completion states
 *
 * Uses shared connection - shares WebSocket with roomEventsAtom and others.
 */
export const roomStateAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  if (Option.isNone(roomId) || roomId.value.trim() === "") {
    return Stream.make(initialRoomState);
  }
  return roomStateStreamFromEvents(getRoomEventStream(roomId.value), initialRoomState);
});

// =============================================================================
// Connection Status Atom (Shared Connection)
// =============================================================================

/**
 * Connection status atom.
 *
 * Tracks WebSocket connection lifecycle:
 * - connecting: Initial connection attempt
 * - connected: WebSocket is open and syncing events
 * - reconnecting: Connection lost, EventLogRemote is retrying
 * - disconnected: Connection failed
 *
 * Uses shared connection - the same SubscriptionRef that the WebSocket
 * wrapper updates. No additional WebSocket connection created.
 */
export const connectionStatusAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  if (Option.isNone(roomId) || roomId.value.trim() === "") {
    return Stream.make(initialConnectionState);
  }
  return getRoomConnectionStatus(roomId.value);
});

/**
 * Simple connection status string atom for easy UI binding.
 * Uses shared connection - derives from the same status ref.
 */
export const connectionStatusSimpleAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  if (Option.isNone(roomId) || roomId.value.trim() === "") {
    return Stream.succeed<ConnectionStatus>("disconnected");
  }
  return Stream.map(getRoomConnectionStatus(roomId.value), (state) => state.status);
});

// =============================================================================
// Legacy Compatibility
// =============================================================================

/**
 * @deprecated Use roomStateStreamFromEvents instead.
 */
export const scorePanelStreamFromEvents = (
  events: Stream.Stream<RoomEvent>,
  initial: ScorePanelState
): Stream.Stream<ScorePanelState> =>
  Stream.map(
    roomStateStreamFromEvents(events, initialRoomState),
    deriveScorePanelState
  );

/**
 * @deprecated Use roomStateAtom instead.
 * Kept for backward compatibility with existing components.
 * Uses shared connection - shares WebSocket with other atoms.
 */
export const scorePanelAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  if (Option.isNone(roomId) || roomId.value.trim() === "") {
    return Stream.make(deriveScorePanelState(initialRoomState));
  }
  const roomStateStream = roomStateStreamFromEvents(
    getRoomEventStream(roomId.value),
    initialRoomState
  );
  return Stream.map(roomStateStream, deriveScorePanelState);
});
