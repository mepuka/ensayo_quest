/**
 * useTurn - Turn submission and audio upload hook
 *
 * Handles turn submission with optimistic UI, chains audio upload
 * after submit success, and enforces double-submit prevention.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - useTurn section
 */
import { useCallback, useEffect, useRef } from "react";
import { useAtomValue, useAtomSet, Result } from "@effect-atom/atom-react";
import * as Option from "effect/Option";
import {
  submitTurnOptimistic,
  submitTurnFn,
  uploadAudioFn
} from "../atoms";
import { useRoom } from "./useRoom";
import { useRecording } from "./useRecording";
import { encodeWav } from "../asr/wav";

export type SubmitStatus = "idle" | "pending" | "success" | "error";
export type UploadStatus = "idle" | "pending" | "success" | "error";

export interface UseTurnResult {
  /** Current prompt to respond to */
  currentPrompt: string | null;
  /** Submit the current ASR result as a turn */
  submitTurn: () => void;
  /** Turn submission status */
  submitStatus: SubmitStatus;
  /** Audio upload status */
  uploadStatus: UploadStatus;
  /** Whether submission is allowed */
  canSubmit: boolean;
  /** Submission error (if any) */
  submitError: unknown | null;
}

/**
 * Hook for turn submission management.
 *
 * Handles:
 * - Optimistic turn submission
 * - Chained audio upload after submit success (Invariant #9)
 * - Double-submit prevention (Invariant #5)
 * - ASR result clearing after upload completes
 *
 * @example
 * ```tsx
 * function SubmitButton() {
 *   const { canSubmit, submitTurn, submitStatus } = useTurn();
 *
 *   return (
 *     <AsyncButton
 *       onClick={submitTurn}
 *       disabled={!canSubmit}
 *       loading={submitStatus === "pending"}
 *     >
 *       Submit
 *     </AsyncButton>
 *   );
 * }
 * ```
 */
export function useTurn(): UseTurnResult {
  const { state, roomId } = useRoom();
  const { result: asrResult, clearResult, appReady } = useRecording();

  const submit = useAtomSet(submitTurnOptimistic);
  const submitResult = useAtomValue(submitTurnFn);
  const uploadAudio = useAtomSet(uploadAudioFn);
  const uploadAudioResult = useAtomValue(uploadAudioFn);

  const submitStatus: SubmitStatus = Result.isWaiting(submitResult)
    ? "pending"
    : Result.isSuccess(submitResult)
      ? "success"
      : Result.isFailure(submitResult)
        ? "error"
        : "idle";

  const uploadStatus: UploadStatus = Result.isWaiting(uploadAudioResult)
    ? "pending"
    : Result.isSuccess(uploadAudioResult)
      ? "success"
      : Result.isFailure(uploadAudioResult)
        ? "error"
        : "idle";

  // Prevent double-submit: disabled when pending or no ASR result
  const canSubmit = submitStatus !== "pending"
    && uploadStatus !== "pending"
    && asrResult !== null
    && appReady === "ready"
    && state?.status === "playing";

  // Track which turnId we've already uploaded (avoid duplicates)
  const uploadedTurnIdRef = useRef<string | null>(null);

  // Chain audio upload after submitTurn success (Invariant #9)
  useEffect(() => {
    if (
      Result.isSuccess(submitResult) &&
      !Result.isWaiting(submitResult) &&
      asrResult &&
      roomId
    ) {
      const submitValue = Option.getOrUndefined(Result.value(submitResult));
      const turnId = submitValue?.turnId;
      if (turnId && uploadedTurnIdRef.current !== turnId) {
        uploadedTurnIdRef.current = turnId;
        const wav = encodeWav(asrResult.audio, asrResult.sampleRate);
        uploadAudio({
          turnId,
          roomId,
          requestId: asrResult.requestId,
          audio: wav,
          contentType: "audio/wav"
        });
      }
    }
  }, [submitResult, asrResult, roomId, uploadAudio]);

  // Clear ASR result only after audio upload succeeds
  useEffect(() => {
    if (Result.isSuccess(uploadAudioResult) && !Result.isWaiting(uploadAudioResult)) {
      clearResult();
    }
  }, [uploadAudioResult, clearResult]);

  // Submit with debounce protection
  const submitTurn = useCallback(() => {
    if (!canSubmit || !asrResult || !roomId) return;

    submit({
      roomId,
      requestId: asrResult.requestId,
      transcript: asrResult.transcript,
      language: "es",
      clientTimestamp: Date.now(),
      audioFeatures: {
        durationMs: asrResult.durationMs,
        pauseCount: 0,
        speakingRateWpm: 0
      }
    });
  }, [canSubmit, asrResult, roomId, submit]);

  // Derive currentPrompt from state
  const currentPrompt = state?.seedPrompt ?? null;

  return {
    currentPrompt,
    submitTurn,
    submitStatus,
    uploadStatus,
    canSubmit,
    submitError: Result.isFailure(submitResult)
      ? Option.getOrUndefined(Result.error(submitResult))
      : null
  };
}
