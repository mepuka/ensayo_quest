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
import { TranscriptionFailed } from "../errors";

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

  const mockWorkerManager: Worker.WorkerManager = {
    [Worker.WorkerManagerTypeId]: Worker.WorkerManagerTypeId,
    spawn: <I, O, E>(_options: any) => {
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
          return Effect.fail(new TranscriptionFailed({ reason: "unknown_request" }));
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
    expect(capturedAudio).not.toBeNull();
    expect(capturedAudio!).toEqual(testAudio);
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
    expect(progressEvents[0]!._tag).toBe("PreloadProgress");
    expect((progressEvents[0]! as PreloadProgress).status).toBe("initiate");
    expect(progressEvents[3]!._tag).toBe("PreloadComplete");
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

/**
 * Concurrent Preload Tests
 *
 * Tests that verify concurrent preload calls are handled correctly.
 * The single-flight behavior is implemented in the worker (asrWorker.ts ensureTranscriber),
 * but these tests verify the LocalAsr API accepts concurrent calls gracefully.
 *
 * @see docs/plans/2026-01-20-asr-worker-effect-hardening.md - Phase 4
 */
describe("LocalAsr concurrent preload", () => {
  it("concurrent preload calls all complete successfully", async () => {
    let preloadCallCount = 0;

    const { workerLayer, spawnerLayer } = createMockWorkerLayer({
      onPreload: () => {
        preloadCallCount++;
        return [new PreloadComplete({ _tag: "PreloadComplete", status: "loaded" })];
      }
    });
    const captureLayer = createMockCaptureLayer();
    const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);

    // Create the LocalAsr service and call preload concurrently
    const program = Effect.gen(function* () {
      const localAsr = yield* makeLocalAsr;

      // Fire off multiple concurrent preload calls
      const results = yield* Effect.all([
        localAsr.preload(),
        localAsr.preload(),
        localAsr.preload()
      ], { concurrency: "unbounded" });

      return results;
    }).pipe(Effect.provide(layer), Effect.scoped);

    const results = await Effect.runPromise(program);

    // All three calls should complete successfully
    expect(results.length).toBe(3);
    results.forEach((result) => {
      expect(result.status).toBe("loaded");
    });

    // With mock, each call goes through (single-flight is in real worker)
    expect(preloadCallCount).toBe(3);
  });

  it("concurrent preload calls receive their own progress callbacks", async () => {
    const progressCallbacks: PreloadEvent[][] = [[], [], []];

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
          progress: 0.5
        }),
        new PreloadComplete({ _tag: "PreloadComplete", status: "loaded" })
      ]
    });
    const captureLayer = createMockCaptureLayer();
    const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);

    const program = Effect.gen(function* () {
      const localAsr = yield* makeLocalAsr;

      // Each preload call gets its own progress callback
      yield* Effect.all([
        localAsr.preload((event) => progressCallbacks[0]!.push(event)),
        localAsr.preload((event) => progressCallbacks[1]!.push(event)),
        localAsr.preload((event) => progressCallbacks[2]!.push(event))
      ], { concurrency: "unbounded" });

      return progressCallbacks;
    }).pipe(Effect.provide(layer), Effect.scoped);

    const result = await Effect.runPromise(program);

    // Each callback received events
    result.forEach((events, i) => {
      expect(events.length).toBe(3);
      expect(events[0]!._tag).toBe("PreloadProgress");
      expect(events[2]!._tag).toBe("PreloadComplete");
    });
  });

  it("concurrent transcribe and preload calls do not interfere", async () => {
    let preloadCalled = false;
    let transcribeCalled = false;

    const { workerLayer, spawnerLayer } = createMockWorkerLayer({
      onPreload: () => {
        preloadCalled = true;
        return [new PreloadComplete({ _tag: "PreloadComplete", status: "loaded" })];
      },
      onTranscribe: (audio, sampleRate) => {
        transcribeCalled = true;
        return "Hola mundo";
      }
    });
    const captureLayer = createMockCaptureLayer();
    const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);

    const program = Effect.gen(function* () {
      const localAsr = yield* makeLocalAsr;

      // Fire preload and transcribe concurrently
      const [preloadResult, transcribeResult] = yield* Effect.all([
        localAsr.preload(),
        localAsr.transcribe(new Float32Array([0.1, 0.2]), 16000)
      ], { concurrency: "unbounded" });

      return { preloadResult, transcribeResult };
    }).pipe(Effect.provide(layer), Effect.scoped);

    const { preloadResult, transcribeResult } = await Effect.runPromise(program);

    expect(preloadCalled).toBe(true);
    expect(transcribeCalled).toBe(true);
    expect(preloadResult.status).toBe("loaded");
    expect(transcribeResult.transcript).toBe("Hola mundo");
  });

  it("sequential preload calls work correctly", async () => {
    let callOrder: string[] = [];

    const { workerLayer, spawnerLayer } = createMockWorkerLayer({
      onPreload: () => {
        callOrder.push("preload");
        // First call loads, subsequent calls find it already loaded
        const status = callOrder.filter((c) => c === "preload").length === 1
          ? "loaded"
          : "already_loaded";
        return [new PreloadComplete({ _tag: "PreloadComplete", status })];
      }
    });
    const captureLayer = createMockCaptureLayer();
    const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);

    const program = Effect.gen(function* () {
      const localAsr = yield* makeLocalAsr;

      // Sequential calls - second should see already_loaded
      const first = yield* localAsr.preload();
      const second = yield* localAsr.preload();

      return { first, second };
    }).pipe(Effect.provide(layer), Effect.scoped);

    const { first, second } = await Effect.runPromise(program);

    expect(first.status).toBe("loaded");
    expect(second.status).toBe("already_loaded");
    expect(callOrder.length).toBe(2);
  });
});
