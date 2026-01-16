import type { RoomEvent, RoomHistoryEntry, TurnEvaluation } from "../../shared/src/RoomProtocol";

// =============================================================================
// Room State Types
// =============================================================================

/**
 * Room connection/session status.
 * - connecting: Initial state before first event
 * - playing: Active room session
 * - completed: Session finished successfully
 * - error: Unrecoverable error occurred
 */
export type RoomStatus = "connecting" | "playing" | "completed" | "error";

/**
 * Status of the current turn's scoring.
 * - idle: No turn in progress
 * - pending: Turn accepted, awaiting score
 * - scored: Turn has been scored
 */
export type TurnScoringStatus = "idle" | "pending" | "scored";

/**
 * Current turn scoring state.
 */
export type TurnState = {
  readonly turnId: string | null;
  readonly scoringStatus: TurnScoringStatus;
  readonly evaluation: TurnEvaluation | null;
};

/**
 * Error information when room enters error state.
 */
export type RoomErrorState = {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
};

/**
 * Full room state projected from event stream.
 *
 * @see docs/ARCHITECTURE.md - Invariant #1: EventLog is the single source of truth
 */
export type RoomState = {
  // Room identity
  readonly roomId: string | null;
  readonly scenarioId: string | null;

  // Room status
  readonly status: RoomStatus;

  // Progress tracking
  readonly currentTurnIndex: number;
  readonly objectivesCompleted: number;

  // Conversation history
  readonly history: ReadonlyArray<RoomHistoryEntry>;

  // Current turn state
  readonly turn: TurnState;

  // Error state (when status === "error")
  readonly error: RoomErrorState | null;

  // Completion state (when status === "completed")
  readonly completionSummary: string | null;
};

// =============================================================================
// Initial State
// =============================================================================

export const initialTurnState: TurnState = {
  turnId: null,
  scoringStatus: "idle",
  evaluation: null
};

export const initialRoomState: RoomState = {
  roomId: null,
  scenarioId: null,
  status: "connecting",
  currentTurnIndex: 0,
  objectivesCompleted: 0,
  history: [],
  turn: initialTurnState,
  error: null,
  completionSummary: null
};

// =============================================================================
// Event Handlers (typed reducers)
// =============================================================================

type EventHandler<E extends RoomEvent> = (state: RoomState, event: E) => RoomState;

/**
 * Handle RoomSnapshot - initializes or rehydrates full room state.
 * Received on initial connection or reconnection.
 */
const handleRoomSnapshot: EventHandler<Extract<RoomEvent, { type: "RoomSnapshot" }>> = (
  state,
  event
) => ({
  ...state,
  roomId: event.roomId,
  scenarioId: event.scenarioId,
  status: event.status === "completed" ? "completed" : "playing",
  currentTurnIndex: event.currentTurnIndex,
  objectivesCompleted: event.objectivesCompleted,
  history: event.history,
  // Reset turn state on snapshot
  turn: initialTurnState,
  // Clear any previous error
  error: null
});

/**
 * Handle TurnAccepted - player turn has been accepted, awaiting scoring.
 */
const handleTurnAccepted: EventHandler<Extract<RoomEvent, { type: "TurnAccepted" }>> = (
  state,
  event
) => ({
  ...state,
  turn: {
    turnId: event.turnId,
    scoringStatus: "pending",
    evaluation: null
  }
});

/**
 * Handle ScoreUpdated - turn has been scored with evaluation.
 */
const handleScoreUpdated: EventHandler<Extract<RoomEvent, { type: "ScoreUpdated" }>> = (
  state,
  event
) => ({
  ...state,
  turn: {
    turnId: event.turnId,
    scoringStatus: "scored",
    evaluation: event.evaluation
  }
});

/**
 * Handle RoomCompleted - session finished successfully.
 */
const handleRoomCompleted: EventHandler<Extract<RoomEvent, { type: "RoomCompleted" }>> = (
  state,
  event
) => ({
  ...state,
  status: "completed",
  completionSummary: event.summary,
  // Clear turn state on completion
  turn: initialTurnState
});

/**
 * Handle RoomError - error occurred during session.
 * Note: RoomError has type: "Error" in the protocol.
 */
const handleRoomError: EventHandler<Extract<RoomEvent, { type: "Error" }>> = (
  state,
  event
) => ({
  ...state,
  status: "error",
  error: {
    code: event.code,
    message: event.message,
    retryable: event.retryable
  }
});

// =============================================================================
// Main Reducer
// =============================================================================

/**
 * Reduce room events into state using typed handlers.
 *
 * This is the correct client-side pattern for event projection.
 * Server uses EventLog.group() with atomic handlers; client uses
 * Stream.scan with pure reducers.
 *
 * @see effect/packages/experimental/src/EventLog.ts - Server handler pattern
 */
export const reduceRoomEvent = (state: RoomState, event: RoomEvent): RoomState => {
  switch (event.type) {
    case "RoomSnapshot":
      return handleRoomSnapshot(state, event);
    case "TurnAccepted":
      return handleTurnAccepted(state, event);
    case "ScoreUpdated":
      return handleScoreUpdated(state, event);
    case "RoomCompleted":
      return handleRoomCompleted(state, event);
    case "Error":
      return handleRoomError(state, event);
    default: {
      // Exhaustive check - TypeScript will error if we miss a case
      const _exhaustive: never = event;
      return state;
    }
  }
};

// =============================================================================
// Legacy Compatibility (ScorePanelState)
// =============================================================================

/**
 * @deprecated Use RoomState instead. Kept for backward compatibility.
 */
export type ScorePanelStatus = "pending" | "partial" | "final";

/**
 * @deprecated Use RoomState instead. Kept for backward compatibility.
 */
export type ScorePanelState = {
  turnId: string;
  status: ScorePanelStatus;
  overall: number | null;
  npcPrompt: string | null;
};

/**
 * @deprecated Use initialRoomState instead.
 */
export const initialScorePanelState = (turnId: string): ScorePanelState => ({
  turnId,
  status: "pending",
  overall: null,
  npcPrompt: null
});

/**
 * Derive ScorePanelState from RoomState for backward compatibility.
 */
export const deriveScorePanelState = (state: RoomState): ScorePanelState => ({
  turnId: state.turn.turnId ?? "unknown",
  status: state.turn.scoringStatus === "scored" ? "final" : "pending",
  overall: state.turn.evaluation?.overallScore ?? null,
  npcPrompt: state.turn.evaluation?.nextPrompt ?? null
});
