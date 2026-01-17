/**
 * Turn Atoms - Pending turn + audio upload state (ephemeral)
 *
 * Optimistic UI overlay for pending turns.
 * Clears when TurnAccepted arrives from EventLog.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Optimistic UI section
 */
import { Atom } from "@effect-atom/atom-react";
import { submitTurnFn, type SubmitTurnInput } from "./room.ops";

// =============================================================================
// Pending Turn Types
// =============================================================================

/**
 * Pending turn for optimistic UI.
 * UI-only; cleared by matching requestId when TurnAccepted arrives.
 */
export type PendingTurn = {
  requestId: string;
  transcript: string;
  createdAt: number;
};

// =============================================================================
// Pending Turns Atom
// =============================================================================

/**
 * List of pending turns awaiting server confirmation.
 * Used for optimistic UI overlay.
 */
export const pendingTurnsAtom = Atom.make<ReadonlyArray<PendingTurn>>([]);

// =============================================================================
// Audio Upload State
// =============================================================================

/**
 * Audio upload status per turn.
 */
export type AudioUploadStatus = "pending" | "uploading" | "uploaded" | "error";

/**
 * Audio upload state for tracking upload progress.
 */
export type AudioUploadState = {
  turnId: string;
  status: AudioUploadStatus;
  error?: string;
};

/**
 * Map of turn ID to audio upload state.
 */
export const audioUploadsAtom = Atom.make<ReadonlyMap<string, AudioUploadState>>(new Map());

// =============================================================================
// Optimistic UI Atoms
// =============================================================================

/**
 * Optimistic wrapper for pending turns.
 * Allows immediate UI updates while server request is in flight.
 */
export const pendingTurnsOptimisticAtom = pendingTurnsAtom.pipe(Atom.optimistic);

/**
 * Optimistic submit turn operation.
 *
 * Immediately adds pending turn to UI, then submits to server.
 * On success: pending turn is replaced by confirmed turn from EventLog.
 * On failure: pending turn is removed, error shown.
 *
 * @see docs/ARCHITECTURE.md - Invariant #1: EventLog is the single source of truth
 */
export const submitTurnOptimistic = pendingTurnsOptimisticAtom.pipe(
  Atom.optimisticFn({
    reducer: (current: ReadonlyArray<PendingTurn>, input: SubmitTurnInput): ReadonlyArray<PendingTurn> => [
      ...current,
      {
        requestId: input.requestId,
        transcript: input.transcript,
        createdAt: Date.now()
      }
    ],
    fn: submitTurnFn
  })
);
