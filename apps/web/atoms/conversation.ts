/**
 * Conversation Atoms - Derived atoms for turn history
 *
 * Derives conversation views from room state.
 * Includes optimistic pending turns overlay.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Conversation section
 */
import { Atom, Result } from "@effect-atom/atom-react";
import * as Option from "effect/Option";
import { roomStateAtom, initialRoomState } from "./room";
import { pendingTurnsOptimisticAtom, type PendingTurn } from "./turn";
import type { RoomHistoryEntry } from "../../shared/src/RoomProtocol";

// =============================================================================
// Conversation History
// =============================================================================

/**
 * Full conversation history from room state.
 */
export const conversationHistoryAtom = Atom.readable((get): ReadonlyArray<RoomHistoryEntry> => {
  const stateResult = get(roomStateAtom);
  const state = Option.getOrUndefined(Result.value(stateResult));
  return state?.history ?? [];
});

/**
 * User turns only.
 * Note: RoomHistoryEntry uses "user" role, not "player".
 */
export const userTurnsAtom = conversationHistoryAtom.pipe(
  Atom.map((history) => history.filter((h) => h.role === "user"))
);

/**
 * NPC turns only.
 */
export const npcTurnsAtom = conversationHistoryAtom.pipe(
  Atom.map((history) => history.filter((h) => h.role === "npc"))
);

// =============================================================================
// Current Prompt
// =============================================================================

/**
 * Current prompt to respond to.
 * Either current step's prompt or latest NPC response.
 */
export const currentPromptAtom = Atom.readable((get): string | null => {
  const stateResult = get(roomStateAtom);
  const state = Option.getOrUndefined(Result.value(stateResult));
  // Use seedPrompt as initial prompt, then latest NPC response
  const npcTurns = state?.history.filter((h) => h.role === "npc") ?? [];
  const lastNpc = npcTurns[npcTurns.length - 1];
  return lastNpc?.text ?? state?.seedPrompt ?? null;
});

// =============================================================================
// Conversation with Pending (Optimistic UI)
// =============================================================================

/**
 * Extended history entry type that includes pending marker and optional fields.
 */
export type ConversationEntry = {
  turnId: string;
  role: "user" | "npc";
  text: string;
  pending?: boolean;
  createdAt?: number;
};

/**
 * Conversation history with pending turns overlaid.
 * Pending turns are UI-only and cleared when TurnAccepted arrives.
 *
 * Note: We match pending turns by turnId since RoomHistoryEntry has turnId.
 */
export const conversationWithPendingAtom = Atom.readable((get): ReadonlyArray<ConversationEntry> => {
  const history = get(conversationHistoryAtom);
  const pending = get(pendingTurnsOptimisticAtom);

  // Convert history to ConversationEntry format
  const historyEntries: ConversationEntry[] = history.map((h) => ({
    turnId: h.turnId,
    role: h.role,
    text: h.text,
    pending: false
  }));

  if (pending.length === 0) return historyEntries;

  // Filter out pending turns that have been confirmed (matching requestId as turnId)
  const confirmedTurnIds = new Set(history.map((h) => h.turnId));
  const unconfirmedPending = pending.filter((p) => !confirmedTurnIds.has(p.requestId));

  if (unconfirmedPending.length === 0) return historyEntries;

  return [
    ...historyEntries,
    ...unconfirmedPending.map((turn): ConversationEntry => ({
      turnId: turn.requestId,
      role: "user",
      text: turn.transcript,
      createdAt: turn.createdAt,
      pending: true
    }))
  ];
});
