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
export type TurnScoringStatus = "idle" | "pending" | "partial" | "scored";

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
 * Participant in a room session.
 * @see docs/ARCHITECTURE.md - Invariant #8: Participant membership tracked in state
 */
export type Participant = {
  readonly playerId: string;
  readonly sessionId: string;
  readonly isConnected: boolean;
  readonly joinedAt: number;
};

/**
 * Whose turn it is currently.
 */
export type CurrentTurnHolder = {
  readonly type: "Player" | "NPC";
  readonly id: string;
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

  // Room metadata (from RoomInitialized event, survives refresh)
  readonly seedPrompt: string | null;
  readonly topic: string | null;
  readonly level: string | null;

  // Room status
  readonly status: RoomStatus;

  // Progress tracking
  readonly currentStepIndex: number;
  readonly currentTurnIndex: number;
  readonly objectivesCompleted: number;

  // Whose turn is it
  readonly currentTurnHolder: CurrentTurnHolder | null;

  // Participants (Architecture Invariant #8)
  readonly participants: ReadonlyArray<Participant>;

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
  seedPrompt: null,
  topic: null,
  level: null,
  status: "connecting",
  currentStepIndex: 0,
  currentTurnIndex: 0,
  objectivesCompleted: 0,
  currentTurnHolder: null,
  participants: [],
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
 * Handle RoomInitialized - room created with seed data.
 * Persists room metadata (seedPrompt, topic, level) that survives refresh.
 *
 * Only transitions to "playing" from "connecting" state. Preserves "completed"
 * or "error" states to handle late retry events from createRoom idempotency.
 *
 * @see docs/ARCHITECTURE.md - Events section
 */
const handleRoomInitialized: EventHandler<Extract<RoomEvent, { type: "RoomInitialized" }>> = (
  state,
  event
) => ({
  ...state,
  roomId: event.roomId,
  scenarioId: event.scenarioId,
  seedPrompt: event.seedPrompt,
  topic: event.topic,
  level: event.level,
  // Only transition to "playing" from initial "connecting" state
  // Preserve "completed" or "error" states to avoid regression on retry
  status: state.status === "connecting" ? "playing" : state.status
});

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
  currentStepIndex: event.currentTurnIndex, // Map from legacy field
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
 * Appends the player's transcript to conversation history.
 */
const handleTurnAccepted: EventHandler<Extract<RoomEvent, { type: "TurnAccepted" }>> = (
  state,
  event
) => ({
  ...state,
  history: [
    ...state.history,
    {
      turnId: event.turnId,
      role: "user" as const,
      text: event.transcript
    }
  ],
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
) => {
  if (event.status === "partial") {
    if (state.turn.scoringStatus === "scored") {
      return state;
    }
    return {
      ...state,
      turn: {
        turnId: event.turnId,
        scoringStatus: "partial",
        evaluation: event.evaluation
      }
    };
  }

  return {
    ...state,
    turn: {
      turnId: event.turnId,
      scoringStatus: "scored",
      evaluation: event.evaluation
    }
  };
};

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

/**
 * Handle PlayerJoined - a player has connected to the room.
 * @see docs/ARCHITECTURE.md - Invariant #8: Participant membership tracked in state
 */
const handlePlayerJoined: EventHandler<Extract<RoomEvent, { type: "PlayerJoined" }>> = (
  state,
  event
) => ({
  ...state,
  // Update roomId if not set (first event for this room)
  roomId: state.roomId ?? event.roomId,
  // Transition from connecting to playing on first join
  status: state.status === "connecting" ? "playing" : state.status,
  participants: [
    // Remove any existing entry for this session (reconnection case)
    ...state.participants.filter((p) => p.sessionId !== event.sessionId),
    // Add new participant as connected
    {
      playerId: event.playerId,
      sessionId: event.sessionId,
      isConnected: true,
      joinedAt: event.timestamp
    }
  ]
});

/**
 * Handle PlayerDisconnected - a player has disconnected from the room.
 * @see docs/ARCHITECTURE.md - Invariant #8: Participant membership tracked in state
 */
const handlePlayerDisconnected: EventHandler<Extract<RoomEvent, { type: "PlayerDisconnected" }>> = (
  state,
  event
) => ({
  ...state,
  participants: state.participants.map((p) =>
    p.sessionId === event.sessionId ? { ...p, isConnected: false } : p
  )
});

/**
 * Handle NpcTurnGenerated - NPC has generated a response.
 * Adds NPC content to history.
 */
const handleNpcTurnGenerated: EventHandler<Extract<RoomEvent, { type: "NpcTurnGenerated" }>> = (
  state,
  event
) => ({
  ...state,
  history: [
    ...state.history,
    {
      turnId: event.turnId,
      role: "npc" as const,
      text: event.content
    }
  ],
  currentStepIndex: event.stepIndex
});

/**
 * Handle TurnAdvanced - turn has advanced to next step.
 * Updates whose turn it is.
 */
const handleTurnAdvanced: EventHandler<Extract<RoomEvent, { type: "TurnAdvanced" }>> = (
  state,
  event
) => ({
  ...state,
  currentStepIndex: event.toStepIndex,
  currentTurnHolder: {
    type: event.nextParticipantType,
    id: event.nextParticipantId
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
    case "RoomInitialized":
      return handleRoomInitialized(state, event);
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
    case "PlayerJoined":
      return handlePlayerJoined(state, event);
    case "PlayerDisconnected":
      return handlePlayerDisconnected(state, event);
    case "NpcTurnGenerated":
      return handleNpcTurnGenerated(state, event);
    case "TurnAdvanced":
      return handleTurnAdvanced(state, event);
    case "AudioUploaded":
      // AudioUploaded is a backend coordination event - no frontend state change
      return state;
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
  status: state.turn.scoringStatus === "scored"
    ? "final"
    : state.turn.scoringStatus === "partial"
      ? "partial"
      : "pending",
  overall: state.turn.evaluation?.overallScore ?? null,
  npcPrompt: state.turn.evaluation?.nextPrompt ?? null
});
