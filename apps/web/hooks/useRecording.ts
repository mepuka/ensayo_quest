/**
 * useRecording - Recording state and operations hook
 *
 * Provides recording phase, ASR results, and controls.
 * Handles cleanup on unmount and auto-stop on duration limit.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - useRecording section
 */
import { useEffect, useRef, useCallback } from "react";
import { useAtomValue, useAtomSet } from "@effect-atom/atom-react";
import {
  appReadyAtom,
  recordingPhaseAtom,
  asrResultAtom,
  recordingMetricsAtom,
  speechProbabilityAtom,
  micPermissionAtom,
  shouldAutoStopAtom,
  preloadModelFn,
  type AppReadyState,
  type RecordingPhase,
  type AsrResult,
  type RecordingMetrics,
  type MicPermission
} from "../atoms";

export interface UseRecordingResult {
  /** App readiness state */
  appReady: AppReadyState;
  /** Whether recording is allowed */
  canRecord: boolean;
  /** Current recording phase */
  phase: RecordingPhase;
  /** ASR result (transcript + audio) */
  result: AsrResult | null;
  /** Recording metrics (duration, etc.) */
  metrics: RecordingMetrics;
  /** Current speech probability (0-1) */
  speechProbability: number;
  /** Microphone permission status */
  micPermission: MicPermission;
  /** Preload ASR model */
  preload: () => void;
  /** Start recording */
  start: () => void;
  /** Stop recording */
  stop: () => void;
  /** Clear ASR result */
  clearResult: () => void;
}

/**
 * Hook for recording management.
 *
 * Handles:
 * - Cleanup on unmount (stops active recording)
 * - Auto-stop when duration limit reached
 * - Recording state tracking via ref
 *
 * @example
 * ```tsx
 * function RecordingPanel() {
 *   const { phase, canRecord, start, stop, speechProbability } = useRecording();
 *
 *   return (
 *     <div>
 *       <RecordingButton
 *         phase={phase}
 *         probability={speechProbability}
 *         onClick={phase === "listening" ? stop : start}
 *         disabled={!canRecord}
 *       />
 *       <Waveform active={phase === "listening"} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useRecording(): UseRecordingResult {
  // Read atoms - Atom.readable returns values directly, Atom.make with Stream returns Result
  // appReadyAtom, recordingPhaseAtom, shouldAutoStopAtom use Atom.readable -> direct values
  // asrResultAtom, recordingMetricsAtom, speechProbabilityAtom, micPermissionAtom use Atom.make -> direct values
  const appReady: AppReadyState = useAtomValue(appReadyAtom);
  const phase: RecordingPhase = useAtomValue(recordingPhaseAtom);
  const result: AsrResult | null = useAtomValue(asrResultAtom);
  const metrics: RecordingMetrics = useAtomValue(recordingMetricsAtom);
  const speechProbability: number = useAtomValue(speechProbabilityAtom);
  const micPermission: MicPermission = useAtomValue(micPermissionAtom);
  const shouldAutoStop: boolean = useAtomValue(shouldAutoStopAtom);

  // Operations
  const preload = useAtomSet(preloadModelFn);
  const setAsrResult = useAtomSet(asrResultAtom);

  // Track active recording for cleanup
  const isRecordingRef = useRef(false);

  // Start recording - placeholder until VAD integration
  const startRecording = useCallback(() => {
    isRecordingRef.current = true;
    // TODO: Trigger VAD start via atom
    console.log("Recording started");
  }, []);

  // Stop recording - placeholder until VAD integration
  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;
    // TODO: Trigger VAD stop via atom
    console.log("Recording stopped");
  }, []);

  // Cleanup on unmount - stop any active recording
  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        stopRecording();
      }
    };
  }, [stopRecording]);

  // Auto-stop when duration limit reached
  useEffect(() => {
    if (shouldAutoStop && isRecordingRef.current) {
      stopRecording();
    }
  }, [shouldAutoStop, stopRecording]);

  // Clear result
  const clearResult = useCallback(() => {
    setAsrResult(null);
  }, [setAsrResult]);

  return {
    appReady,
    canRecord: appReady === "ready" && (phase === "ready" || phase === "result"),
    phase,
    result,
    metrics,
    speechProbability,
    micPermission,
    preload: () => preload(),
    start: startRecording,
    stop: stopRecording,
    clearResult
  };
}
