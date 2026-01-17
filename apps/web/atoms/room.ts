/**
 * Room Atoms - Event-sourced room state
 *
 * Re-exports from eventlog module with proper naming conventions.
 * Uses Stream.scan for event projection.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Atom Structure
 * @see docs/ARCHITECTURE.md - Invariant #1: EventLog is the single source of truth
 */
import { Atom } from "@effect-atom/atom-react";
import { Stream } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  getRoomEventStream,
  initialConnectionState,
  type ConnectionState
} from "../eventlog/EventLogClient";
import {
  initialRoomState,
  reduceRoomEvent,
  type RoomState
} from "../eventlog/RoomEventReducer";

// Re-export types
export type { RoomState } from "../eventlog/RoomEventReducer";
export { initialRoomState } from "../eventlog/RoomEventReducer";

// =============================================================================
// Room ID Atom (URL param binding)
// =============================================================================

/**
 * Room ID from URL search param.
 * Returns Option<string> - None when param not present or invalid.
 *
 * Uses Atom.searchParam with schema validation.
 */
export const roomIdAtom = Atom.searchParam("roomId", { schema: Schema.String });

// =============================================================================
// Room Events Stream
// =============================================================================

/**
 * Raw room event stream atom.
 * Emits individual RoomEvent objects as they arrive.
 *
 * Uses shared connection via getRoomEventStream.
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
 * Full room state atom - event-sourced via Stream.scan.
 *
 * Projects all events into complete room state including:
 * - Room identity and status
 * - Conversation history
 * - Current turn scoring
 * - Error and completion states
 *
 * @see docs/ARCHITECTURE.md - Invariant #1: EventLog is the single source of truth
 */
export const roomStateAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  if (Option.isNone(roomId) || roomId.value.trim() === "") {
    return Stream.make(initialRoomState);
  }
  return Stream.scan(getRoomEventStream(roomId.value), initialRoomState, reduceRoomEvent);
});
