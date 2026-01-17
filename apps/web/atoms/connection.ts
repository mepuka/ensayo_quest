/**
 * Connection Atoms - WebSocket status, reconnection, sync state
 *
 * Wraps eventlog connection status with derived sync state.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Connection section
 */
import { Atom, Result } from "@effect-atom/atom-react";
import { Effect, Stream } from "effect";
import * as Option from "effect/Option";
import {
  getRoomConnectionStatus,
  clearRoomConnection,
  initialConnectionState,
  type ConnectionStatus
} from "../eventlog/EventLogClient";
import { roomIdAtom, roomStateAtom } from "./room";

// Re-export types
export type { ConnectionStatus } from "../eventlog/EventLogClient";

// =============================================================================
// Connection Status Atom
// =============================================================================

/**
 * Connection status from EventLogClient.
 *
 * Tracks WebSocket connection lifecycle:
 * - connecting: Initial connection attempt
 * - connected: WebSocket is open and syncing events
 * - reconnecting: Connection lost, retrying
 * - disconnected: Connection failed
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
 */
export const connectionStatusSimpleAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  if (Option.isNone(roomId) || roomId.value.trim() === "") {
    return Stream.succeed<ConnectionStatus>("disconnected");
  }
  return Stream.map(getRoomConnectionStatus(roomId.value), (state) => state.status);
});

// =============================================================================
// Sync State
// =============================================================================

/**
 * Sync state for UI (show "syncing" indicator after reconnect).
 */
export type SyncState = "synced" | "syncing" | "disconnected" | "stale";

/**
 * Derived sync state from connection and room state.
 */
export const syncStateAtom = Atom.readable((get): SyncState => {
  const roomId = get(roomIdAtom);
  const connResult = get(connectionStatusAtom);
  const roomStateResult = get(roomStateAtom);

  if (Option.isNone(roomId)) return "disconnected";

  // Get connection status from result
  const conn = Result.isSuccess(connResult)
    ? Option.getOrElse(Result.value(connResult), () => initialConnectionState).status
    : "disconnected";

  if (conn === "disconnected") return "disconnected";
  if (conn === "connecting" || conn === "reconnecting") return "syncing";
  if (conn === "connected" && Result.isSuccess(roomStateResult)) return "synced";
  return "syncing";
});

// =============================================================================
// Reconnection Operation
// =============================================================================

/**
 * Force reconnection operation.
 * Clears current connection; next atom read triggers new connection.
 */
export const reconnectFn = Atom.fn<{ roomId: string }>()(
  Effect.fnUntraced(function* ({ roomId }) {
    clearRoomConnection(roomId);
    yield* Effect.logInfo(`Reconnect requested for room ${roomId}`);
  })
);
