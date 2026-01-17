/**
 * useRoom - Room state and operations hook
 *
 * Provides room state, conversation history, and room creation controls.
 * Wraps atoms into clean component API.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - useRoom section
 */
import { useCallback } from "react";
import { useAtomValue, useAtomSet } from "@effect-atom/atom-react";
import { Result } from "@effect-atom/atom-react";
import * as Option from "effect/Option";
import {
  roomIdAtom,
  roomStateAtom,
  conversationWithPendingAtom,
  createRoomFn,
  reconnectFn,
  type RoomState,
  type ConversationEntry,
  type CreateRoomInput
} from "../atoms";
import { useConnection } from "./useConnection";

export type CreateStatus = "idle" | "pending" | "success" | "error";

export interface UseRoomResult {
  /** Current room ID (null if no room) */
  roomId: string | null;
  /** Room state from event projection */
  state: RoomState | null;
  /** Conversation history with pending turns */
  conversation: ReadonlyArray<ConversationEntry>;
  /** Connection status */
  connection: ReturnType<typeof useConnection>;
  /** Create a new room */
  create: (input: CreateRoomInput) => void;
  /** Room creation status */
  createStatus: CreateStatus;
  /** Room creation error (if any) */
  createError: unknown | null;
  /** Force reconnection */
  reconnect: () => void;
}

/**
 * Hook for room management.
 *
 * Components never import atoms directly - only via hooks.
 *
 * @example
 * ```tsx
 * function RoomHeader() {
 *   const { roomId, state, createStatus, create } = useRoom();
 *
 *   if (!roomId) {
 *     return (
 *       <AsyncButton
 *         result={createRoomFn}
 *         onClick={() => create({ requestId: crypto.randomUUID(), topic: "travel", level: "A2", mode: "practice" })}
 *       >
 *         Create Room
 *       </AsyncButton>
 *     );
 *   }
 *
 *   return <h1>Room: {roomId}</h1>;
 * }
 * ```
 */
export function useRoom(): UseRoomResult {
  const roomIdOption = useAtomValue(roomIdAtom);
  const roomId = Option.getOrNull(roomIdOption);

  // roomStateAtom uses Atom.make with Stream, returns Result
  const roomStateResult = useAtomValue(roomStateAtom);
  const state: RoomState | null = Result.isSuccess(roomStateResult)
    ? Option.getOrElse(Result.value(roomStateResult), () => null)
    : null;

  // conversationWithPendingAtom uses Atom.readable, returns direct value
  const conversation: ReadonlyArray<ConversationEntry> = useAtomValue(conversationWithPendingAtom);

  const connection = useConnection();

  const create = useAtomSet(createRoomFn);
  const createResult = useAtomValue(createRoomFn);

  const triggerReconnect = useAtomSet(reconnectFn);

  // Derive create status from Result
  const createStatus: CreateStatus = Result.isWaiting(createResult)
    ? "pending"
    : Result.isSuccess(createResult)
      ? "success"
      : Result.isFailure(createResult)
        ? "error"
        : "idle";

  const createError = Result.isFailure(createResult)
    ? Result.error(createResult)
    : null;

  const reconnect = useCallback(() => {
    if (roomId) {
      triggerReconnect({ roomId });
    }
  }, [roomId, triggerReconnect]);

  return {
    roomId,
    state,
    conversation,
    connection,
    create,
    createStatus,
    createError,
    reconnect
  };
}
