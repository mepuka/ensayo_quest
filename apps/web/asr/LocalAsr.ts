import { Context, Effect, Layer, Ref, Stream } from "effect";
import type { Scope } from "effect/Scope";
import * as Fiber from "effect/Fiber";
import { Worker as PlatformWorker } from "@effect/platform";
import { BrowserWorker } from "@effect/platform-browser";
import type { ASRResult } from "./types";
import { WorkletCapture, WorkletCaptureLive } from "./worklet/WorkletCapture";
import {
  ASRWorkerRequest,
  Preload,
  Transcribe,
  type PreloadEvent
} from "./worker/WorkerClient";
import { appendAudioBuffer } from "./audioBuffer";

export interface LocalAsrService {
  start: () => Effect.Effect<void, Error, never>;
  stop: () => Effect.Effect<ASRResult, Error, never>;
  /**
   * Preload the Whisper model in the worker.
   * Call during app initialization for better UX.
   *
   * @param onProgress - Optional callback to receive progress events during model loading.
   *   Receives PreloadProgress events during download (status, file, progress, loaded, total)
   *   and a final PreloadComplete event when done.
   *
   * @see ensayo_quest-m3q: Add Whisper model preloading for better UX
   */
  preload: (onProgress?: (event: PreloadEvent) => void) => Effect.Effect<{ status: "loaded" | "already_loaded" }, Error, never>;
  /**
   * Transcribe audio directly (for VAD-captured audio).
   * Use this when audio is captured externally (e.g., by MicVAD).
   *
   * @param audio - Float32Array of audio samples
   * @param sampleRate - Sample rate of the audio (typically 16000 for VAD)
   *
   * @see ensayo_quest-og3: Phase 3 - VAD → ASR Integration
   */
  transcribe: (audio: Float32Array, sampleRate: number) => Effect.Effect<{ transcript: string }, Error, never>;
}

export class LocalAsr extends Context.Tag("LocalAsr")<LocalAsr, LocalAsrService>() {}

// Legacy type for backwards compatibility
export type LocalAsrType = {
  start: () => Effect.Effect<void, Error, Scope>;
  stop: () => Effect.Effect<ASRResult, Error, Scope>;
};

export const buildAsrWorkerUrl = (baseUrl: string) =>
  new URL("/workers/asrWorker.js", baseUrl).toString();

const spawnBrowserWorker = (id: number) =>
  new Worker(buildAsrWorkerUrl(window.location.href), { type: "module" });

export const browserWorkerLayer = BrowserWorker.layer(spawnBrowserWorker);

// Scoped resource: worker is spawned eagerly and terminated when scope closes
export const makeLocalAsr = Effect.gen(function* () {
  const capture = yield* WorkletCapture;

  // Create serialized worker client - handles schema encode/decode automatically
  // Worker spawned in service scope - will be cleaned up when layer scope closes
  const worker = yield* PlatformWorker.makeSerialized<ASRWorkerRequest>({});

  const bufferRef = yield* Ref.make<Float32Array<ArrayBufferLike>>(new Float32Array());
  const sampleRateRef = yield* Ref.make(16000);
  const streamRef = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null);

  const start = Effect.fn(function* () {
    yield* capture.start();
    const existingStream = yield* Ref.get(streamRef);
    if (!existingStream) {
      const fiber = yield* Stream.runForEach(capture.stream, (chunk) =>
        Ref.set(sampleRateRef, chunk.sampleRate).pipe(
          Effect.zipRight(
            Ref.update(bufferRef, (current) =>
              appendAudioBuffer(current, chunk.samples as Float32Array)
            )
          )
        )
      ).pipe(Effect.fork);
      yield* Ref.set(streamRef, fiber);
    }
  }, Effect.mapError((cause) => new Error(String(cause))));

  const stop = Effect.fn(function* () {
    const streamFiber = yield* Ref.get(streamRef);
    if (streamFiber) {
      yield* Fiber.interrupt(streamFiber).pipe(Effect.asVoid);
      yield* Ref.set(streamRef, null);
    }
    yield* capture.stop();
    const audio = yield* Ref.get(bufferRef);
    const sampleRate = yield* Ref.get(sampleRateRef);
    yield* Ref.set(bufferRef, new Float32Array());
    // Worker is now guaranteed to exist (created eagerly in service scope)
    // Use executeEffect for single-response transcription
    const response = yield* worker.executeEffect(
      new Transcribe({
        requestId: crypto.randomUUID(),
        audio,
        sampleRate,
        config: undefined
      })
    );
    const durationMs =
      sampleRate > 0 ? Math.round((audio.length / sampleRate) * 1000) : 0;
    return {
      transcript: response.transcript,
      durationMs,
      chunkCount: audio.length > 0 ? 1 : 0,
      sampleRate,
      audio
    };
  }, Effect.mapError((cause) => new Error(String(cause))));

  /**
   * Preload the Whisper model in the worker.
   * Consumes the progress stream from the worker, calling onProgress for each event.
   * Returns status indicating whether model was newly loaded or already cached.
   *
   * @param onProgress - Optional callback for progress events during model loading
   * @see ensayo_quest-m3q: Add Whisper model preloading for better UX
   */
  const preload = (onProgress?: (event: PreloadEvent) => void) =>
    Effect.gen(function* () {
      // Use execute() for streaming response (Preload returns Stream<PreloadEvent>)
      const progressStream = worker.execute(
        new Preload({
          requestId: crypto.randomUUID(),
          config: undefined
        })
      );

      // Track final status from the PreloadComplete event
      let finalStatus: "loaded" | "already_loaded" = "loaded";

      // Consume the stream, calling onProgress for each event
      yield* Stream.runForEach(progressStream, (event) =>
        Effect.sync(() => {
          // Call the progress callback if provided
          onProgress?.(event);
          // Capture the final status from PreloadComplete event
          if (event._tag === "PreloadComplete") {
            finalStatus = event.status;
          }
        })
      );

      return { status: finalStatus };
    }).pipe(Effect.mapError((cause) => new Error(String(cause))));

  /**
   * Transcribe audio directly (for VAD-captured audio).
   * Sends audio to the ASR worker without using WorkletCapture.
   * Uses executeEffect for single-response transcription.
   *
   * @see ensayo_quest-og3: Phase 3 - VAD → ASR Integration
   */
  const transcribe = (audio: Float32Array, sampleRate: number) =>
    Effect.gen(function* () {
      const response = yield* worker.executeEffect(
        new Transcribe({
          requestId: crypto.randomUUID(),
          audio,
          sampleRate,
          config: undefined
        })
      );
      return { transcript: response.transcript };
    }).pipe(Effect.mapError((cause) => new Error(String(cause))));

  return { start, stop, preload, transcribe };
});

// Layer.scoped ensures worker is cleaned up when the layer scope closes
// This should be used with ManagedRuntime in React for proper lifecycle management
export const LocalAsrLive = Layer.scoped(LocalAsr, makeLocalAsr);
