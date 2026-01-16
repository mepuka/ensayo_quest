import { Context, Effect, Layer, Ref, Stream } from "effect";
import type { Scope } from "effect/Scope";
import * as Fiber from "effect/Fiber";
import { Worker as PlatformWorker } from "@effect/platform";
import { BrowserWorker } from "@effect/platform-browser";
import type { ASRResult } from "./types";
import { WorkletCapture, WorkletCaptureLive } from "./worklet/WorkletCapture";
import {
  createWorkerClient,
  type AsrWorker,
  encodeTranscribeRequest,
  type TranscribeRequest,
  type TranscribeResponse
} from "./worker/WorkerClient";
import { TranscriptionFailed } from "./errors";
import { appendAudioBuffer } from "./audioBuffer";

export interface LocalAsrService {
  start: () => Effect.Effect<void, Error, never>;
  stop: () => Effect.Effect<ASRResult, Error, never>;
}

export class LocalAsr extends Context.Tag("LocalAsr")<LocalAsr, LocalAsrService>() {}

// Legacy type for backwards compatibility
export type LocalAsrType = {
  start: () => Effect.Effect<void, Error, Scope>;
  stop: () => Effect.Effect<ASRResult, Error, Scope>;
};

export const buildAsrWorkerUrl = (baseUrl: string) =>
  new URL("/asrWorker.js", baseUrl).toString();

const spawnBrowserWorker = (id: number) =>
  new Worker(buildAsrWorkerUrl(window.location.href), { type: "module" });

export const browserWorkerLayer = BrowserWorker.layer(spawnBrowserWorker);

// Scoped resource: worker is spawned eagerly and terminated when scope closes
export const makeLocalAsr = Effect.gen(function* () {
  const manager = yield* PlatformWorker.WorkerManager;
  const spawner = yield* PlatformWorker.Spawner;
  const capture = yield* WorkletCapture;

  // Worker spawned in service scope - will be cleaned up when layer scope closes
  const worker = yield* manager
    .spawn<TranscribeRequest, TranscribeResponse, TranscriptionFailed>({
      encode: (message) => Effect.succeed(encodeTranscribeRequest(message))
    })
    .pipe(Effect.provideService(PlatformWorker.Spawner, spawner));
  const client = createWorkerClient(worker);

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
    const response = yield* client.transcribe(audio, sampleRate);
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

  return { start, stop };
});

// Layer.scoped ensures worker is cleaned up when the layer scope closes
// This should be used with ManagedRuntime in React for proper lifecycle management
export const LocalAsrLive = Layer.scoped(LocalAsr, makeLocalAsr);
