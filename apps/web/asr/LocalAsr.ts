import { Effect } from "effect";
import { Worker as PlatformWorker } from "@effect/platform";
import { BrowserWorker } from "@effect/platform-browser";
import type { ASRResult } from "./types";
import { WorkletCapture } from "./worklet/WorkletCapture";
import {
  createWorkerClient,
  type AsrWorker,
  encodeTranscribeRequest,
  type TranscribeRequest,
  type TranscribeResponse
} from "./worker/WorkerClient";
import { TranscriptionFailed } from "./errors";

export type LocalAsr = {
  start: () => Effect.Effect<void, Error, never>;
  stop: () => Effect.Effect<ASRResult, Error, never>;
};

const spawnBrowserWorker = (id: number) =>
  new Worker(new URL("./worker/asrWorker.ts", import.meta.url), { type: "module" });

export const browserWorkerLayer = BrowserWorker.layer(spawnBrowserWorker);

export const makeLocalAsr = Effect.gen(function* () {
  const manager = yield* PlatformWorker.WorkerManager;
  const spawner = yield* PlatformWorker.Spawner;
  const capture = yield* WorkletCapture;
  let worker: AsrWorker | null = null;
  let client: ReturnType<typeof createWorkerClient> | null = null;

  const start = Effect.fn(function* () {
    if (!worker) {
      worker = yield* manager
        .spawn<TranscribeRequest, TranscribeResponse, TranscriptionFailed>({
          encode: (message) => Effect.succeed(encodeTranscribeRequest(message))
        })
        .pipe(Effect.provideService(PlatformWorker.Spawner, spawner));
      client = createWorkerClient(worker);
    }
    yield* capture.start();
  });

  const stop = Effect.fn(function* () {
    const result =
      client?.transcribe(new Float32Array(), 16000) ??
      Effect.fail(new TranscriptionFailed({ reason: "worker_not_ready" }));
    const response = yield* result;
    return {
      transcript: response.transcript,
      durationMs: 0,
      chunkCount: 0
    };
  });

  return { start, stop };
});
