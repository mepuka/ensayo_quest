/**
 * LocalAsr Tests
 *
 * Tests for the LocalAsr service which uses makeSerialized workers.
 *
 * @see docs/plans/2026-01-20-asr-worker-effect-hardening.md - Phase 4
 */
import { it, expect, describe } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { Worker } from "@effect/platform";
import { makeLocalAsr, LocalAsr } from "../LocalAsr";
import { WorkletCapture, type WorkletCaptureService } from "../worklet/WorkletCapture";
import {
  ASRWorkerRequest,
  TranscribeResult,
  PreloadComplete,
  PreloadProgress,
  type PreloadEvent
} from "../worker/protocol";

/**
 * Create a mock WorkerManager that spawns serialized workers with custom handlers.
 *
 * The mock intercepts makeSerialized calls and returns a SerializedWorker
 * whose execute/executeEffect call the provided handlers.
 */
const createMockWorkerLayer = (handlers: {
  onPreload?: () => PreloadEvent[];
  onTranscribe?: (audio: Float32Array, sampleRate: number) => string;
}) => {
  // Track worker instance to ensure single-flight behavior
  let workerInstanceCount = 0;

  const mockWorkerManager = {
    [Worker.WorkerManagerTypeId]: Worker.WorkerManagerTypeId,
    spawn: <I, O, E>() => {
      workerInstanceCount++;
      return Effect.succeed({
        id: workerInstanceCount,
        execute: (request: ASRWorkerRequest) => {
          if (request._tag === "Preload") {
            const events = handlers.onPreload?.() ?? [
              new PreloadComplete({ _tag: "PreloadComplete", status: "loaded" })
            ];
            return Stream.fromIterable(events);
          }
          // Transcribe returns a single result, but execute returns Stream
          if (request._tag === "Transcribe") {
            const transcript =
              handlers.onTranscribe?.(request.audio, request.sampleRate) ?? "";
            return Stream.succeed(
              new TranscribeResult({ _tag: "TranscribeResult", transcript })
            );
          }
          return Stream.empty;
        },
        executeEffect: (request: ASRWorkerRequest) => {
          if (request._tag === "Transcribe") {
            const transcript =
              handlers.onTranscribe?.(request.audio, request.sampleRate) ?? "";
            return Effect.succeed(
              new TranscribeResult({ _tag: "TranscribeResult", transcript })
            );
          }
          if (request._tag === "Preload") {
            // executeEffect for Preload should return last event
            const events = handlers.onPreload?.() ?? [
              new PreloadComplete({ _tag: "PreloadComplete", status: "loaded" })
            ];
            const lastEvent = events[events.length - 1];
            return Effect.succeed(lastEvent);
          }
          return Effect.fail(new Error("Unknown request type"));
        }
      } as unknown as Worker.Worker<I, O, E>);
    }
  };

  const workerLayer = Layer.succeed(Worker.WorkerManager, mockWorkerManager);
  const spawnerLayer = Layer.succeed(Worker.Spawner, () => ({}));

  return { workerLayer, spawnerLayer, getInstanceCount: () => workerInstanceCount };
};

/**
 * Create a mock WorkletCapture for testing.
 */
const createMockCaptureLayer = () => {
  const mockCapture: WorkletCaptureService = {
    start: () => Effect.void,
    stop: () => Effect.void,
    stream: Stream.empty
  };
  return Layer.succeed(WorkletCapture, mockCapture);
};

describe("LocalAsr", () => {
  it("returns a LocalASR instance with all methods", async () => {
    const { workerLayer, spawnerLayer } = createMockWorkerLayer({});
    const captureLayer = createMockCaptureLayer();
    const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);

    const program = makeLocalAsr.pipe(
      Effect.provide(layer),
      Effect.scoped
    );

    await Effect.runPromise(
      Effect.map(program, (localAsr) => {
        expect(localAsr.start).toBeDefined();
        expect(localAsr.stop).toBeDefined();
        expect(localAsr.preload).toBeDefined();
        expect(localAsr.transcribe).toBeDefined();
      })
    );
  });

  it("transcribe sends audio to worker and returns result", async () => {
    let capturedAudio: Float32Array | null = null;
    let capturedSampleRate = 0;

    const { workerLayer, spawnerLayer } = createMockWorkerLayer({
      onTranscribe: (audio, sampleRate) => {
        capturedAudio = audio;
        capturedSampleRate = sampleRate;
        return "Hola mundo";
      }
    });
    const captureLayer = createMockCaptureLayer();
    const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);

    const testAudio = new Float32Array([0.1, 0.2, 0.3]);

    const program = Effect.gen(function* () {
      const localAsr = yield* makeLocalAsr;
      return yield* localAsr.transcribe(testAudio, 16000);
    }).pipe(Effect.provide(layer), Effect.scoped);

    const result = await Effect.runPromise(program);

    expect(result.transcript).toBe("Hola mundo");
    expect(capturedAudio).toEqual(testAudio);
    expect(capturedSampleRate).toBe(16000);
  });

  it("preload calls worker and returns status", async () => {
    let preloadCalled = false;

    const { workerLayer, spawnerLayer } = createMockWorkerLayer({
      onPreload: () => {
        preloadCalled = true;
        return [new PreloadComplete({ _tag: "PreloadComplete", status: "loaded" })];
      }
    });
    const captureLayer = createMockCaptureLayer();
    const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);

    const program = Effect.gen(function* () {
      const localAsr = yield* makeLocalAsr;
      return yield* localAsr.preload();
    }).pipe(Effect.provide(layer), Effect.scoped);

    const result = await Effect.runPromise(program);

    expect(preloadCalled).toBe(true);
    expect(result.status).toBe("loaded");
  });

  it("preload returns already_loaded when model was cached", async () => {
    const { workerLayer, spawnerLayer } = createMockWorkerLayer({
      onPreload: () => [
        new PreloadComplete({ _tag: "PreloadComplete", status: "already_loaded" })
      ]
    });
    const captureLayer = createMockCaptureLayer();
    const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);

    const program = Effect.gen(function* () {
      const localAsr = yield* makeLocalAsr;
      return yield* localAsr.preload();
    }).pipe(Effect.provide(layer), Effect.scoped);

    const result = await Effect.runPromise(program);

    expect(result.status).toBe("already_loaded");
  });

  it("preload streams progress events to callback", async () => {
    const progressEvents: PreloadEvent[] = [];

    const { workerLayer, spawnerLayer } = createMockWorkerLayer({
      onPreload: () => [
        new PreloadProgress({
          _tag: "PreloadProgress",
          status: "initiate",
          file: "model.bin"
        }),
        new PreloadProgress({
          _tag: "PreloadProgress",
          status: "progress",
          file: "model.bin",
          progress: 0.5
        }),
        new PreloadProgress({
          _tag: "PreloadProgress",
          status: "done",
          file: "model.bin"
        }),
        new PreloadComplete({ _tag: "PreloadComplete", status: "loaded" })
      ]
    });
    const captureLayer = createMockCaptureLayer();
    const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);

    const program = Effect.gen(function* () {
      const localAsr = yield* makeLocalAsr;
      return yield* localAsr.preload((event) => {
        progressEvents.push(event);
      });
    }).pipe(Effect.provide(layer), Effect.scoped);

    const result = await Effect.runPromise(program);

    expect(result.status).toBe("loaded");
    expect(progressEvents.length).toBe(4);
    expect(progressEvents[0]._tag).toBe("PreloadProgress");
    expect((progressEvents[0] as PreloadProgress).status).toBe("initiate");
    expect(progressEvents[3]._tag).toBe("PreloadComplete");
  });
});

describe("LocalAsr edge cases", () => {
  it("transcribe handles empty transcript", async () => {
    const { workerLayer, spawnerLayer } = createMockWorkerLayer({
      onTranscribe: () => ""
    });
    const captureLayer = createMockCaptureLayer();
    const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);

    const program = Effect.gen(function* () {
      const localAsr = yield* makeLocalAsr;
      return yield* localAsr.transcribe(new Float32Array([0.1]), 16000);
    }).pipe(Effect.provide(layer), Effect.scoped);

    const result = await Effect.runPromise(program);
    expect(result.transcript).toBe("");
  });

  it("transcribe works with large audio arrays", async () => {
    const largeAudio = new Float32Array(16000 * 10); // 10 seconds at 16kHz
    let receivedLength = 0;

    const { workerLayer, spawnerLayer } = createMockWorkerLayer({
      onTranscribe: (audio) => {
        receivedLength = audio.length;
        return "Long audio transcription";
      }
    });
    const captureLayer = createMockCaptureLayer();
    const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);

    const program = Effect.gen(function* () {
      const localAsr = yield* makeLocalAsr;
      return yield* localAsr.transcribe(largeAudio, 16000);
    }).pipe(Effect.provide(layer), Effect.scoped);

    const result = await Effect.runPromise(program);

    expect(result.transcript).toBe("Long audio transcription");
    expect(receivedLength).toBe(160000);
  });

  it("preload without progress callback still works", async () => {
    const { workerLayer, spawnerLayer } = createMockWorkerLayer({
      onPreload: () => [
        new PreloadProgress({ _tag: "PreloadProgress", status: "initiate" }),
        new PreloadComplete({ _tag: "PreloadComplete", status: "loaded" })
      ]
    });
    const captureLayer = createMockCaptureLayer();
    const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);

    const program = Effect.gen(function* () {
      const localAsr = yield* makeLocalAsr;
      // No progress callback provided
      return yield* localAsr.preload();
    }).pipe(Effect.provide(layer), Effect.scoped);

    const result = await Effect.runPromise(program);
    expect(result.status).toBe("loaded");
  });
});
