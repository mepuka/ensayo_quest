import { Atom } from "@effect-atom/atom-react";
import { Effect, Stream } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { RoomEvent } from "../../shared/src/RoomProtocol";
import { getRoomStreamUrl, makeRoomEventStream } from "./EventLogClient";
import {
  initialRoomState,
  reduceRoomEvent,
  deriveScorePanelState,
  type RoomState,
  type ScorePanelState
} from "./RoomEventReducer";

// =============================================================================
// Room ID Atom
// =============================================================================

export const roomIdAtom = Atom.searchParam("roomId", { schema: Schema.String });

// =============================================================================
// Event Stream
// =============================================================================

const roomEventStreamForId = (roomId: string) =>
  makeRoomEventStream({ roomId, url: getRoomStreamUrl(roomId) }).pipe(
    Stream.tap((event) => Effect.sync(() => console.info("RoomEvent", event)))
  );

/**
 * Raw room event stream atom.
 * Emits individual RoomEvent objects as they arrive.
 */
export const roomEventsAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  if (Option.isNone(roomId) || roomId.value.trim() === "") {
    return Stream.empty;
  }
  return roomEventStreamForId(roomId.value);
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
 */
export const roomStateAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  if (Option.isNone(roomId) || roomId.value.trim() === "") {
    return Stream.make(initialRoomState);
  }
  return roomStateStreamFromEvents(roomEventStreamForId(roomId.value), initialRoomState);
});

// =============================================================================
// Derived Streams (helpers for creating derived state streams)
// =============================================================================

/**
 * Create a derived stream that maps room state to a specific field.
 * Each derived atom creates its own stream to avoid atom composition issues.
 */
const makeRoomStateStream = (roomId: string) =>
  roomStateStreamFromEvents(roomEventStreamForId(roomId), initialRoomState);

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
 */
export const scorePanelAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  if (Option.isNone(roomId) || roomId.value.trim() === "") {
    return Stream.make(deriveScorePanelState(initialRoomState));
  }
  return Stream.map(makeRoomStateStream(roomId.value), deriveScorePanelState);
});
