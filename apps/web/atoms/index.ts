/**
 * Atoms Barrel Export
 *
 * Central export for all atom modules.
 * Follows naming conventions:
 * - *Atom suffix for reactive state
 * - *Fn suffix for operations
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Atom Structure
 */

// Room atoms - Event-sourced room state
export {
  roomIdAtom,
  roomEventsAtom,
  roomStateAtom,
  initialRoomState,
  type RoomState
} from "./room";

// Room operations - HTTP calls
export {
  createRoomFn,
  submitTurnFn,
  uploadAudioFn,
  type CreateRoomInput,
  type SubmitTurnInput,
  type UploadAudioInput,
  type CreateRoomResult,
  type SubmitTurnResult,
  type UploadAudioResult
} from "./room.ops";

// Turn atoms - Pending turns and audio upload state
export {
  pendingTurnsAtom,
  pendingTurnsOptimisticAtom,
  submitTurnOptimistic,
  audioUploadsAtom,
  type PendingTurn,
  type AudioUploadStatus,
  type AudioUploadState
} from "./turn";

// App atoms - Readiness coordination
export { appReadyAtom, type AppReadyState } from "./app";

// Recording atoms - Model, VAD, ASR base atoms
export {
  modelLoadingAtom,
  modelStatusAtom,
  vadEventAtom,
  speechProbabilityAtom,
  asrResultAtom,
  recordingMetricsAtom,
  micPermissionAtom,
  SpeechStart,
  SpeechEnd,
  FrameProcessed,
  matchVadEvent,
  isVadEvent,
  type VadEvent,
  type ModelLoadingState,
  type AsrResult,
  type RecordingMetrics,
  type MicPermission
} from "./recording";

// Recording operations
export { preloadModelFn, startRecordingFn, stopRecordingFn } from "./recording.ops";

// Recording derived atoms
export {
  recordingPhaseAtom,
  shouldAutoStopAtom,
  canRecordAtom,
  isRecordingAtom,
  type RecordingPhase
} from "./recording.derived";

// Recording VAD config and state
export {
  vadConfig,
  vadActiveAtom,
  vadSessionAtom,
  VadService,
  VadServiceLive,
  VadServiceConfigured,
  VadInitError,
  type VadConfig,
  type VadSessionState,
  type VadServiceOptions,
  type VadServiceEvent
} from "./recording.vad";

// Connection atoms
export {
  connectionStatusAtom,
  connectionStatusSimpleAtom,
  syncStateAtom,
  reconnectFn,
  type ConnectionStatus,
  type SyncState
} from "./connection";

// Conversation atoms
export {
  conversationHistoryAtom,
  userTurnsAtom,
  npcTurnsAtom,
  currentPromptAtom,
  conversationWithPendingAtom,
  type ConversationEntry
} from "./conversation";

// Score atoms
export {
  scoreHistoryAtom,
  cumulativeScoreAtom,
  latestScoreAtom,
  averageScoreAtom,
  type ScoreEntry
} from "./score";
