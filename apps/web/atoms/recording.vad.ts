/**
 * Recording VAD Atoms - VAD configuration and control state
 *
 * Tuning parameters for language learners (intentionally lenient).
 * VAD integration with Effect layers happens in useRecording hook.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - VAD tuning section
 */
import { Atom } from "@effect-atom/atom-react";

// Re-export VadService types for hook usage
export {
  VadService,
  VadServiceLive,
  VadServiceConfigured,
  VadInitError,
  type VadServiceOptions,
  type VadEvent as VadServiceEvent
} from "../asr/VadService";

// =============================================================================
// VAD Configuration
// =============================================================================

/**
 * VAD tuning parameters for language learners.
 *
 * Intentionally lenient defaults for hesitant speakers:
 * - Lower speech threshold (0.4) catches quieter speech
 * - Longer redemption (1000ms) waits for pauses/hesitation
 * - Minimum speech duration (500ms) filters noise
 *
 * Tune with real user data.
 */
export const vadConfig = {
  /** Speech probability threshold (0-1). Lower = more sensitive. */
  positiveSpeechThreshold: 0.4,

  /** How long to wait (ms) after speech ends before triggering SpeechEnd. */
  redemptionMs: 1000,

  /** Minimum speech duration (ms) to trigger a valid speech segment. */
  minSpeechMs: 500
} as const;

export type VadConfig = typeof vadConfig;

// =============================================================================
// VAD Control State
// =============================================================================

/**
 * Whether VAD should be active.
 * Set to true to start VAD, false to stop.
 *
 * Components use this as a control signal:
 * - Set true when user wants to record
 * - Set false when user stops or component unmounts
 *
 * The useRecording hook subscribes to VadService.events when this is true
 * and updates vadEventAtom/speechProbabilityAtom.
 */
export const vadActiveAtom = Atom.make(false);

// =============================================================================
// VAD Session State
// =============================================================================

/**
 * Current VAD session status for UI feedback.
 */
export type VadSessionState = {
  status: "idle" | "starting" | "running" | "stopping" | "error";
  error?: string;
};

export const vadSessionAtom = Atom.make<VadSessionState>({ status: "idle" });
