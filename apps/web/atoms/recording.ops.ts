/**
 * Recording Operations - Atom.runtime.fn for model loading and VAD recording
 *
 * Uses a SINGLE Atom.runtime with merged layers for proper resource sharing.
 * Layer.scoped in LocalAsrLive ensures the worker is created once per runtime scope.
 *
 * @see docs/plans/2026-01-18-voice-stack-remediation.md - Phase 1.1 (runtime merge)
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Operation atoms section
 */
import { Atom } from "@effect-atom/atom-react";
import { Effect, Layer, Stream, Fiber } from "effect";
import {
  modelLoadingAtom,
  speechProbabilityAtom,
  asrResultAtom,
  recordingMetricsAtom,
  vadEventAtom,
  micPermissionAtom,
  SpeechStart,
  SpeechEnd,
  FrameProcessed
} from "./recording";
import { vadSessionAtom, vadConfig, VadServiceConfigured } from "./recording.vad";
import { LocalAsr, LocalAsrLive, browserWorkerLayer } from "../asr/LocalAsr";
import { WorkletCaptureLive } from "../asr/worklet/WorkletCapture";
import { VadService, type VadEvent as VadServiceEvent } from "../asr/VadService";

// =============================================================================
// Recording Runtime (SINGLE runtime for all operations)
// =============================================================================

/**
 * Combined layer for ALL recording operations.
 *
 * Merges VadService + LocalAsr into a single layer so that:
 * 1. The ASR worker is created once and shared across preload/start/stop
 * 2. Layer.scoped in LocalAsrLive ensures worker lifecycle matches runtime scope
 *
 * @see docs/plans/2026-01-18-voice-stack-remediation.md - Task 1.1
 * @see ensayo_quest-fjb: Phase 1.1 - Merge dual runtimes
 */
const recordingLayer = Layer.mergeAll(
  // VAD configuration for language learners
  VadServiceConfigured({
    baseAssetPath: "/vad",
    onnxWASMBasePath: "/vad/onnx",
    model: "legacy",
    positiveSpeechThreshold: vadConfig.positiveSpeechThreshold,
    // Pass ms directly - vad-web expects milliseconds (fixed in Phase 1.2)
    redemptionMs: vadConfig.redemptionMs,
    minSpeechMs: vadConfig.minSpeechMs,
    submitUserSpeechOnPause: true
  }),
  // LocalAsr with worker + worklet dependencies
  LocalAsrLive.pipe(
    Layer.provide(Layer.mergeAll(browserWorkerLayer, WorkletCaptureLive))
  )
);

/**
 * Single AtomRuntime for all recording operations.
 *
 * CRITICAL: All operations (preload, start, stop) must use THIS runtime
 * to share the same worker instance. Creating multiple runtimes would
 * create multiple workers, wasting the preload.
 */
const recordingRuntime = Atom.runtime(recordingLayer);

// =============================================================================
// Model Preload Operation
// =============================================================================

/**
 * Preload ASR model operation.
 *
 * Updates modelLoadingAtom with progress states:
 * - checking_cache → downloading → initializing → ready
 *
 * Uses LocalAsr.preload() which loads the Whisper model in the WebWorker.
 * Progress is logged to console (worker-side); future work will add streaming progress.
 *
 * @see ensayo_quest-2fo: Phase 2 - Model Preload + Atom Wiring
 */
export const preloadModelFn = recordingRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const localAsr = yield* LocalAsr;

    // Update state: checking cache
    yield* Atom.set(modelLoadingAtom, { status: "checking_cache" });

    // Update state: downloading (optimistic - actual progress logged in worker)
    yield* Atom.set(modelLoadingAtom, { status: "downloading" });

    // Preload the model with error handling
    const preloadResult = yield* localAsr.preload().pipe(
      Effect.tapError((error) =>
        Effect.gen(function* () {
          yield* Atom.set(modelLoadingAtom, {
            status: "error",
            error: String(error)
          });
          yield* Effect.logError("Model preload failed", { error: String(error) });
        })
      )
    );

    // Update state: initializing → ready
    yield* Atom.set(modelLoadingAtom, { status: "initializing" });
    yield* Effect.sleep("100 millis"); // Brief pause for UI feedback
    yield* Atom.set(modelLoadingAtom, { status: "ready" });

    yield* Effect.logInfo("Model preload complete", { status: preloadResult.status });
  })
);

// =============================================================================
// Recording Fiber Tracking
// =============================================================================

/**
 * Atom to track the active recording fiber.
 * Used to interrupt recording on stop.
 */
const recordingFiberAtom = Atom.make<Fiber.RuntimeFiber<void, unknown> | null>(null);

// =============================================================================
// VAD Recording Operations
// =============================================================================

/**
 * Start recording using VAD-based capture.
 *
 * Forks a fiber that:
 * 1. Consumes VadService.events stream
 * 2. Updates atoms on each event (speechProbability, vadEvent, etc.)
 * 3. On SpeechEnd, transcribes audio and sets asrResultAtom
 *
 * The fiber is tracked in recordingFiberAtom for later interruption.
 *
 * @see ensayo_quest-og3: Phase 3 - VAD → ASR Integration
 */
export const startRecordingFn = recordingRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const vad = yield* VadService;
    const localAsr = yield* LocalAsr;

    // Check if already recording
    const existingFiber = yield* Atom.get(recordingFiberAtom);
    if (existingFiber !== null) {
      yield* Effect.logWarning("Recording already in progress");
      return;
    }

    // Update session state
    yield* Atom.set(vadSessionAtom, { status: "starting" });
    yield* Atom.set(micPermissionAtom, "pending");

    // Track speech start time for duration calculation
    let speechStartTime: number | null = null;

    // Fork the VAD event consumer
    const fiber = yield* Stream.runForEach(vad.events, (event: VadServiceEvent) =>
      Effect.gen(function* () {
        switch (event._tag) {
          case "SpeechStart": {
            speechStartTime = event.timestamp;
            yield* Atom.set(vadEventAtom, SpeechStart());
            yield* Atom.set(recordingMetricsAtom, {
              startedAt: event.timestamp,
              durationMs: 0
            });
            yield* Effect.logInfo("Speech started");
            break;
          }

          case "SpeechEnd": {
            const durationMs = speechStartTime
              ? event.timestamp - speechStartTime
              : 0;
            speechStartTime = null;

            yield* Atom.set(vadEventAtom, SpeechEnd({ audio: event.audio }));
            yield* Atom.set(recordingMetricsAtom, {
              startedAt: null,
              durationMs
            });

            // Transcribe the audio using ASR worker
            // VAD outputs audio at 16kHz
            const sampleRate = 16000;
            yield* Effect.logInfo("Transcribing audio", {
              samples: event.audio.length,
              durationMs
            });

            // Use LocalAsr's transcribe method for direct transcription
            const result = yield* localAsr.transcribe(event.audio, sampleRate).pipe(
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  yield* Effect.logError("Transcription failed", { error: String(error) });
                  return { transcript: "" };
                })
              )
            );
            const transcript = result.transcript;

            // Set ASR result
            yield* Atom.set(asrResultAtom, {
              transcript,
              requestId: crypto.randomUUID(),
              durationMs,
              sampleRate,
              audio: event.audio
            });

            yield* Effect.logInfo("Speech ended, transcription complete", {
              durationMs,
              transcript: transcript.slice(0, 50)
            });
            break;
          }

          case "FrameProcessed": {
            yield* Atom.set(speechProbabilityAtom, event.probability);
            yield* Atom.set(vadEventAtom, FrameProcessed({ probability: event.probability }));
            break;
          }
        }
      })
    ).pipe(
      Effect.tapError((error) =>
        Effect.gen(function* () {
          yield* Atom.set(vadSessionAtom, {
            status: "error",
            error: String(error)
          });
          yield* Atom.set(micPermissionAtom, "denied");
          yield* Effect.logError("VAD error", { error: String(error) });
        })
      ),
      Effect.fork
    );

    // Store fiber and update state
    yield* Atom.set(recordingFiberAtom, fiber);
    yield* Atom.set(vadSessionAtom, { status: "running" });
    yield* Atom.set(micPermissionAtom, "granted");

    yield* Effect.logInfo("Recording started");
  })
);

/**
 * Stop recording.
 *
 * Interrupts the recording fiber, which triggers VadService cleanup
 * via Effect finalizers (pause + destroy).
 *
 * @see ensayo_quest-og3: Phase 3 - VAD → ASR Integration
 */
export const stopRecordingFn = recordingRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const fiber = yield* Atom.get(recordingFiberAtom);

    if (fiber === null) {
      yield* Effect.logWarning("No recording in progress");
      return;
    }

    // Update session state
    yield* Atom.set(vadSessionAtom, { status: "stopping" });

    // Interrupt the fiber - this triggers VadService cleanup
    yield* Fiber.interrupt(fiber);
    yield* Atom.set(recordingFiberAtom, null);

    // Reset state
    yield* Atom.set(vadSessionAtom, { status: "idle" });
    yield* Atom.set(speechProbabilityAtom, 0);
    yield* Atom.set(vadEventAtom, null);
    yield* Atom.set(recordingMetricsAtom, { startedAt: null, durationMs: 0 });

    yield* Effect.logInfo("Recording stopped");
  })
);
