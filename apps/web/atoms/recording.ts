/**
 * Recording Atoms - Model, VAD, ASR base atoms
 *
 * Transient atoms for recording state (ephemeral UI state).
 * Uses Data.taggedEnum for VAD events following Effect patterns.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Recording atoms section
 */
import { Atom } from "@effect-atom/atom-react";
import { Data, Match } from "effect";

// =============================================================================
// Model Loading State
// =============================================================================

/**
 * Granular model loading states for progress tracking.
 */
export type ModelLoadingState = {
  status: "idle" | "checking_cache" | "downloading" | "initializing" | "ready" | "error";
  downloadProgress?: number; // 0-100
  error?: string;
};

export const modelLoadingAtom = Atom.make<ModelLoadingState>({ status: "idle" });

/**
 * Simplified model status for component logic.
 */
export const modelStatusAtom = modelLoadingAtom.pipe(
  Atom.map((s) =>
    s.status === "ready" ? ("ready" as const) :
    s.status === "error" ? ("error" as const) :
    ("loading" as const)
  )
);

// =============================================================================
// VAD Events (Data.taggedEnum)
// =============================================================================

/**
 * VAD events using Data.TaggedEnum for proper Effect pattern matching.
 */
export type VadEvent = Data.TaggedEnum<{
  SpeechStart: {};
  SpeechEnd: { audio: Float32Array };
  FrameProcessed: { probability: number };
}>;

export const {
  SpeechStart,
  SpeechEnd,
  FrameProcessed,
  $match: matchVadEvent,
  $is: isVadEvent
} = Data.taggedEnum<VadEvent>();

/**
 * Current VAD event atom.
 * Updated by VAD service, consumed by recording phase derivation.
 */
export const vadEventAtom = Atom.make<VadEvent | null>(null);

/**
 * Speech probability for UI feedback (waveform, mic indicator).
 */
export const speechProbabilityAtom = Atom.make<number>(0);

// =============================================================================
// ASR Result
// =============================================================================

/**
 * ASR result with requestId for idempotent submission.
 * Includes optional error field to surface transcription failures to UI.
 *
 * @see docs/plans/2026-01-20-asr-worker-effect-hardening.md - Phase 3
 */
export type AsrResult = {
  transcript: string;
  requestId: string;
  durationMs: number;
  sampleRate: number;
  audio: Float32Array;
  /** Error reason if transcription failed */
  error?: string;
};

export const asrResultAtom = Atom.make<AsrResult | null>(null);

// =============================================================================
// Recording Metrics
// =============================================================================

/**
 * Recording metrics for duration tracking.
 */
export type RecordingMetrics = {
  startedAt: number | null;
  durationMs: number;
};

export const recordingMetricsAtom = Atom.make<RecordingMetrics>({
  startedAt: null,
  durationMs: 0
});

// =============================================================================
// Microphone Permission
// =============================================================================

/**
 * Microphone permission state.
 */
export type MicPermission = "unknown" | "pending" | "granted" | "denied";

export const micPermissionAtom = Atom.make<MicPermission>("unknown");
