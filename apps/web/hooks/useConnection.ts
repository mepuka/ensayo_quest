/**
 * useConnection - Connection and sync state hook
 *
 * Provides connection status, sync state, and reconnection controls.
 * Handles cleanup on unmount or roomId change.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - useConnection section
 */
import { useEffect } from "react";
import { useAtomValue, useAtomSet } from "@effect-atom/atom-react";
import { Result } from "@effect-atom/atom-react";
import * as Option from "effect/Option";
import {
  roomIdAtom,
  connectionStatusSimpleAtom,
  syncStateAtom,
  reconnectFn,
  type ConnectionStatus,
  type SyncState
} from "../atoms";
import { clearRoomConnection } from "../eventlog/EventLogClient";

export interface UseConnectionResult {
  /** Current WebSocket connection status */
  status: ConnectionStatus;
  /** Sync state (synced/syncing/stale/disconnected) */
  syncState: SyncState;
  /** Trigger reconnection */
  reconnect: () => void;
  /** Whether connected */
  isConnected: boolean;
  /** Whether reconnecting */
  isReconnecting: boolean;
}

/**
 * Hook for connection management.
 *
 * Automatically cleans up connection on unmount or roomId change.
 *
 * @example
 * ```tsx
 * function ConnectionStatus() {
 *   const { status, syncState, reconnect, isConnected } = useConnection();
 *
 *   if (!isConnected) {
 *     return <Button onClick={reconnect}>Reconnect</Button>;
 *   }
 *
 *   return <SyncBadge state={syncState} />;
 * }
 * ```
 */
export function useConnection(): UseConnectionResult {
  const roomIdOption = useAtomValue(roomIdAtom);
  const roomId = Option.getOrNull(roomIdOption);

  // connectionStatusSimpleAtom is stream-based, returns Result
  const statusResult = useAtomValue(connectionStatusSimpleAtom);
  const status: ConnectionStatus = Result.isSuccess(statusResult)
    ? Option.getOrElse(Result.value(statusResult), () => "disconnected" as const)
    : "disconnected";

  // syncStateAtom uses Atom.readable, returns value directly
  const syncState: SyncState = useAtomValue(syncStateAtom);

  const triggerReconnect = useAtomSet(reconnectFn);

  // Cleanup connection on unmount or roomId change
  useEffect(() => {
    return () => {
      if (roomId) {
        clearRoomConnection(roomId);
      }
    };
  }, [roomId]);

  const reconnect = () => {
    if (roomId) {
      triggerReconnect({ roomId });
    }
  };

  return {
    status,
    syncState,
    reconnect,
    isConnected: status === "connected",
    isReconnecting: status === "reconnecting"
  };
}
