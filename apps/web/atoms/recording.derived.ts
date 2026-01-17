/**
 * Recording Derived Atoms - Composed recording state via Atom.readable
 *
 * Uses Data.taggedEnum $match for VAD event discrimination.
 * Granular phases enable precise UI states.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Derived atoms section
 */
import { Atom } from "@effect-atom/atom-react";
import {
  micPermissionAtom,
  modelStatusAtom,
  vadEventAtom,
  asrResultAtom,
  recordingMetricsAtom,
  matchVadEvent
} from "./recording";

// =============================================================================
// Recording Phase
// =============================================================================

/**
 * Granular recording phase for UI state machines.
 *
 * - no_permission: mic permission denied
 * - not_ready: model not loaded
 * - ready: model loaded, waiting for speech
 * - listening: VAD detected speech start
 * - processing: speech ended, ASR running
 * - result: transcript available
 * - error: error occurred
 */
export type RecordingPhase =
  | "no_permission"
  | "not_ready"
  | "ready"
  | "listening"
  | "processing"
  | "result"
  | "error";

/**
 * Recording phase derived from multiple source atoms.
 * Uses Effect Match for VAD event discrimination.
 */
export const recordingPhaseAtom = Atom.readable((get): RecordingPhase => {
  const permission = get(micPermissionAtom);
  const model = get(modelStatusAtom);
  const vad = get(vadEventAtom);
  const asr = get(asrResultAtom);

  // Permission check first
  if (permission === "denied") return "no_permission";

  // Model status
  if (model === "error") return "error";
  if (model !== "ready") return "not_ready";

  // ASR result available
  if (asr) return "result";

  // No VAD event yet
  if (!vad) return "ready";

  // Match VAD events using Data.taggedEnum $match
  return matchVadEvent({
    SpeechEnd: () => "processing" as const,
    SpeechStart: () => "listening" as const,
    FrameProcessed: () => "listening" as const
  })(vad);
});

// =============================================================================
// Auto-stop Logic
// =============================================================================

const MAX_RECORDING_DURATION_MS = 120_000; // 2 minutes

/**
 * Whether recording should auto-stop due to max duration.
 */
export const shouldAutoStopAtom = Atom.readable((get): boolean => {
  const metrics = get(recordingMetricsAtom);
  return metrics.durationMs >= MAX_RECORDING_DURATION_MS;
});

// =============================================================================
// Recording Ready State
// =============================================================================

/**
 * Whether recording can start.
 * Combines permission, model status, and current phase.
 */
export const canRecordAtom = Atom.readable((get): boolean => {
  const phase = get(recordingPhaseAtom);
  return phase === "ready" || phase === "result";
});

/**
 * Whether currently recording (listening for speech or processing).
 */
export const isRecordingAtom = Atom.readable((get): boolean => {
  const phase = get(recordingPhaseAtom);
  return phase === "listening" || phase === "processing";
});
