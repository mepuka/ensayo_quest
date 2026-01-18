import { Effect } from "effect";
import { WorkerRunner } from "@effect/platform";
import { BrowserWorkerRunner } from "@effect/platform-browser";
import { pipeline, env } from "@huggingface/transformers";
import {
  decodeWorkerRequest,
  encodeTranscribeResponse,
  encodePreloadResponse,
  PreloadRequest,
  PreloadResponse,
  PreloadProgress,
  TranscribeRequest,
  TranscribeResponse,
  type WorkerRequest
} from "./WorkerClient";
import { TranscriptionFailed } from "../errors";

// Configure HF Transformers environment for browser
env.allowRemoteModels = true;
// Use local WASM files from /vad/onnx/ (served by dev.ts)
env.backends.onnx.wasm.wasmPaths = "/vad/onnx/";

type TranscriberOutput = { text: string } | Array<{ text: string }>;
type TranscriberFn = (
  audio: Float32Array | { audio: Float32Array; sampling_rate: number },
  options?: { language?: string; task?: string }
) => Promise<TranscriberOutput>;

let transcriber: TranscriberFn | null = null;

const ensureTranscriber = (onProgress?: (progress: PreloadProgress) => void) =>
  Effect.tryPromise({
    try: async () => {
      if (!transcriber) {
        onProgress?.(new PreloadProgress({ type: "preload_progress", status: "initiate" }));

        const asrPipeline = await pipeline(
          "automatic-speech-recognition",
          "Xenova/whisper-base",
          {
            progress_callback: (info: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
              const status = info.status as "initiate" | "download" | "progress" | "done";
              onProgress?.(new PreloadProgress({
                type: "preload_progress",
                status,
                file: info.file,
                progress: info.progress,
                loaded: info.loaded,
                total: info.total
              }));
            }
          }
        );
        transcriber = asrPipeline as TranscriberFn;
      }
    },
    catch: (cause) => new TranscriptionFailed({ reason: String(cause) })
  });

/**
 * Handle transcription request.
 * Uses sampleRate from request to ensure correct transcription.
 */
const transcribe = Effect.fn(function* (request: TranscribeRequest) {
  yield* ensureTranscriber();
  const result = yield* Effect.tryPromise({
    try: () =>
      transcriber!(
        { audio: request.audio, sampling_rate: request.sampleRate },
        { language: "spanish", task: "transcribe" }
      ),
    catch: (cause) => new TranscriptionFailed({ reason: String(cause) })
  });
  const transcript = Array.isArray(result) ? result[0]?.text ?? "" : result.text;
  return new TranscribeResponse({ type: "result", transcript });
});

/**
 * Handle preload request - loads model without transcribing.
 * Returns status indicating whether model was newly loaded or already cached.
 * Logs progress events to console during model download.
 *
 * @see ensayo_quest-m3q: Add Whisper model preloading for better UX
 */
const preload = Effect.fn(function* (_request: PreloadRequest) {
  const wasAlreadyLoaded = transcriber !== null;
  yield* ensureTranscriber((progress) => {
    // Log progress for debugging - in future, emit via streaming
    console.log("[ASR Worker] Preload progress:", progress.status, progress.file ?? "", progress.progress ?? "");
  });
  return new PreloadResponse({
    type: "preload_complete",
    status: wasAlreadyLoaded ? "already_loaded" : "loaded"
  });
});

/**
 * Main request handler - dispatches to transcribe or preload.
 */
const handleRequest = Effect.fn(function* (request: WorkerRequest) {
  if (request.type === "preload") {
    return yield* preload(request);
  }
  return yield* transcribe(request);
});

/**
 * Encode output based on response type.
 */
const encodeOutput = (_request: WorkerRequest, output: TranscribeResponse | PreloadResponse) => {
  if (output.type === "preload_complete") {
    return Effect.succeed(encodePreloadResponse(output as PreloadResponse));
  }
  return Effect.succeed(encodeTranscribeResponse(output as TranscribeResponse));
};

const runnerLayer = WorkerRunner.layer(handleRequest, {
  decode: (message) => Effect.succeed(decodeWorkerRequest(message)),
  encodeOutput,
  encodeError: (_request, error) => Effect.succeed(error)
});

Effect.runPromise(WorkerRunner.launch(runnerLayer).pipe(Effect.provide(BrowserWorkerRunner.layer)));
