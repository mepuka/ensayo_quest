/**
 * ASR Worker - Whisper transcription worker using Effect WorkerRunner.layerSerialized
 *
 * This worker handles:
 * - Model preloading with progress streaming (Preload -> Stream<PreloadEvent>)
 * - Audio transcription (Transcribe -> Effect<TranscribeResult>)
 *
 * Uses single-flight pattern for model loading to prevent concurrent duplicate loads.
 *
 * @module
 */
import { Cause, Deferred, Effect, Either, Exit, FiberId, Ref, Stream } from "effect";
import { WorkerRunner } from "@effect/platform";
import { BrowserWorkerRunner } from "@effect/platform-browser";
import { pipeline, env } from "@huggingface/transformers";

import {
  ASRWorkerRequest,
  PreloadProgress,
  PreloadComplete,
  TranscribeResult,
  type Preload,
  type Transcribe,
  type PreloadEvent
} from "./protocol";
import { TranscriptionFailed } from "../errors";

// -----------------------------------------------------------------------------
// HuggingFace Transformers Configuration
// -----------------------------------------------------------------------------

// Configure HF Transformers environment for browser
env.allowRemoteModels = true;
// Use local WASM files from /vad/onnx/ (served by dev server and prod build)
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = "/vad/onnx/";
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type TranscriberOutput = { text: string } | Array<{ text: string }>;
type TranscriberFn = (
  audio: Float32Array | { audio: Float32Array; sampling_rate: number },
  options?: { language?: string; task?: string }
) => Promise<TranscriberOutput>;

// -----------------------------------------------------------------------------
// Single-Flight Model Loading State Machine
// -----------------------------------------------------------------------------

/**
 * State machine for transcriber lifecycle.
 * Ensures only one load attempt happens even with concurrent requests.
 */
type TranscriberState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Loading"; readonly deferred: Deferred.Deferred<TranscriberFn, TranscriptionFailed> }
  | { readonly _tag: "Ready"; readonly transcriber: TranscriberFn }
  | { readonly _tag: "Failed"; readonly error: TranscriptionFailed };

/**
 * Global state ref for transcriber lifecycle.
 * Uses unsafeMake since this is top-level module state in worker context.
 */
const transcriberRef = Ref.unsafeMake<TranscriberState>({ _tag: "Idle" });

/**
 * Progress callback type for model loading.
 */
type ProgressCallback = (progress: PreloadProgress) => void;

/**
 * Load the Whisper model pipeline.
 * Internal function called by ensureTranscriber when state is Idle.
 */
const loadModel = (onProgress?: ProgressCallback) =>
  Effect.tryPromise({
    try: async () => {
      onProgress?.(
        new PreloadProgress({
          _tag: "PreloadProgress",
          status: "initiate"
        })
      );

      const asrPipeline = await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-base",
        {
          progress_callback: (info: {
            status: string;
            file?: string;
            progress?: number;
            loaded?: number;
            total?: number;
          }) => {
            const status = info.status as "initiate" | "download" | "progress" | "done";
            onProgress?.(
              new PreloadProgress({
                _tag: "PreloadProgress",
                status,
                file: info.file,
                progress: info.progress,
                loaded: info.loaded,
                total: info.total
              })
            );
          }
        }
      );
      return asrPipeline as TranscriberFn;
    },
    catch: (cause) => new TranscriptionFailed({ reason: String(cause) })
  });

/**
 * Result of ensureTranscriber indicating load status.
 */
type EnsureTranscriberResult = {
  readonly transcriber: TranscriberFn;
  /**
   * Indicates the load status for progress streaming:
   * - "already_loaded": Model was already in Ready state (no progress events)
   * - "joined": Joined an in-flight load (no progress events from our callback)
   * - "loaded": We performed the actual load (progress events were emitted)
   */
  readonly loadStatus: "already_loaded" | "joined" | "loaded";
};

const makeEnsureResult = (
  transcriber: TranscriberFn,
  loadStatus: EnsureTranscriberResult["loadStatus"]
): EnsureTranscriberResult => ({ transcriber, loadStatus });

/**
 * Ensure transcriber is loaded, with single-flight semantics.
 *
 * Uses Ref + Deferred pattern:
 * - If Idle: Transitions to Loading, creates Deferred, loads model
 * - If Loading: Waits on existing Deferred (joins in-flight load)
 * - If Ready: Returns cached transcriber immediately
 * - If Failed: Returns cached error immediately
 *
 * Returns the transcriber along with a loadStatus indicating whether this
 * caller performed the load, joined an in-flight load, or found it ready.
 * This allows callers to determine whether to emit progress events.
 *
 * @param onProgress - Optional callback for progress events during initial load
 */
const ensureTranscriber = Effect.fn("ensureTranscriber")(function* (
  onProgress?: ProgressCallback
) {
    // Atomically check state and transition to Loading if Idle
    const action = yield* Ref.modify(transcriberRef, (state): [
      | { readonly _tag: "AlreadyReady"; readonly transcriber: TranscriberFn }
      | { readonly _tag: "AlreadyFailed"; readonly error: TranscriptionFailed }
      | { readonly _tag: "Join"; readonly deferred: Deferred.Deferred<TranscriberFn, TranscriptionFailed> }
      | { readonly _tag: "Load"; readonly deferred: Deferred.Deferred<TranscriberFn, TranscriptionFailed> },
      TranscriberState
    ] => {
      switch (state._tag) {
        case "Ready":
          return [{ _tag: "AlreadyReady", transcriber: state.transcriber }, state];
        case "Failed":
          return [{ _tag: "AlreadyFailed", error: state.error }, state];
        case "Loading":
          return [{ _tag: "Join", deferred: state.deferred }, state];
        case "Idle": {
          // Create deferred synchronously for atomic transition
          // Use FiberId.none since we're in a sync context (Ref.modify callback)
          const deferred = Deferred.unsafeMake<TranscriberFn, TranscriptionFailed>(FiberId.none);
          const newState: TranscriberState = { _tag: "Loading", deferred };
          return [{ _tag: "Load", deferred }, newState];
        }
      }
    });

    switch (action._tag) {
      case "AlreadyReady":
        return makeEnsureResult(action.transcriber, "already_loaded");
      case "AlreadyFailed":
        return yield* action.error;
      case "Join": {
        // Wait for in-flight load to complete
        const transcriber = yield* Deferred.await(action.deferred);
        return makeEnsureResult(transcriber, "joined");
      }
      case "Load": {
        // We won the race - perform the actual load
        // Ensure the deferred is completed on all exit paths to avoid deadlocks.
        const exit: Exit.Exit<TranscriberFn, TranscriptionFailed> =
          yield* Effect.uninterruptibleMask((restore) =>
            restore(loadModel(onProgress)).pipe(Effect.exit)
          );

        yield* Deferred.done(action.deferred, exit);

        if (Exit.isSuccess(exit)) {
          const transcriber = exit.value;
          yield* Ref.set(transcriberRef, { _tag: "Ready", transcriber });
          return makeEnsureResult(transcriber, "loaded");
        }

        const cause = exit.cause;
        const interrupted = Cause.isInterruptedOnly(cause);
        const error: TranscriptionFailed = Either.match(Cause.failureOrCause(cause), {
          onRight: (failure) => failure,
          onLeft: (other) =>
            new TranscriptionFailed({
              reason: interrupted
                ? "Transcriber load interrupted"
                : Cause.pretty(other)
            })
        });

        const nextState: TranscriberState = interrupted
          ? { _tag: "Idle" }
          : { _tag: "Failed", error };

        yield* Ref.set(transcriberRef, nextState);
        return yield* error;
      }
    }
  });

// -----------------------------------------------------------------------------
// Request Handlers
// -----------------------------------------------------------------------------

/**
 * Handle Preload request - streams progress events during model loading.
 *
 * Returns a Stream that emits:
 * - PreloadProgress events during model download (only if this caller performs the load)
 * - PreloadComplete when loading finishes
 *
 * Race condition fix: Uses ensureTranscriber's atomic state check to determine
 * whether this caller should emit progress events. The loadStatus returned by
 * ensureTranscriber is determined atomically during the Ref.modify, eliminating
 * the race window between checking state and starting the load.
 */
const handlePreload = (_request: Preload): Stream.Stream<PreloadEvent, TranscriptionFailed> =>
  Stream.async<PreloadEvent, TranscriptionFailed>((emit) => {
    Effect.runPromise(
      ensureTranscriber((progress) => {
        // Progress callback is only invoked if we won the race and are
        // actually performing the load (action._tag === "Load").
        // Joiners and already-loaded callers never receive progress callbacks.
        emit.single(progress);
      }).pipe(
        Effect.match({
          onSuccess: ({ loadStatus }) => {
            // Map the atomic loadStatus to the appropriate completion status
            const completionStatus = loadStatus === "loaded" ? "loaded" : "already_loaded";
            emit.single(
              new PreloadComplete({
                _tag: "PreloadComplete",
                status: completionStatus
              })
            );
            emit.end();
          },
          onFailure: (error) => {
            emit.failCause(Cause.fail(error));
          }
        })
      )
    );
  });

/**
 * Handle Transcribe request - returns transcription result.
 *
 * Ensures model is loaded (joining in-flight load if needed),
 * then transcribes the audio data.
 */
const handleTranscribe = Effect.fn("handleTranscribe")(function* (request: Transcribe) {
    const { transcriber } = yield* ensureTranscriber();

    const result = yield* Effect.tryPromise({
      try: () =>
        transcriber(
          { audio: request.audio, sampling_rate: request.sampleRate },
          { language: "spanish", task: "transcribe" }
        ),
      catch: (cause) => new TranscriptionFailed({ reason: String(cause) })
    });

    const transcript = Array.isArray(result) ? result[0]?.text ?? "" : result.text;

    return new TranscribeResult({
      _tag: "TranscribeResult",
      transcript
    });
  });

// -----------------------------------------------------------------------------
// Worker Runner Layer
// -----------------------------------------------------------------------------

/**
 * Worker layer using WorkerRunner.layerSerialized for automatic serialization.
 *
 * Handlers return:
 * - Preload: Stream<PreloadEvent, TranscriptionFailed>
 * - Transcribe: Effect<TranscribeResult, TranscriptionFailed>
 */
const runnerLayer = WorkerRunner.layerSerialized(ASRWorkerRequest, {
  Preload: handlePreload,
  Transcribe: handleTranscribe
});

// -----------------------------------------------------------------------------
// Launch Worker
// -----------------------------------------------------------------------------

Effect.runPromise(
  WorkerRunner.launch(runnerLayer).pipe(
    Effect.provide(BrowserWorkerRunner.layer)
  )
);
