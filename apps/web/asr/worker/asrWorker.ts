import { Effect } from "effect";
import { WorkerRunner } from "@effect/platform";
import { BrowserWorkerRunner } from "@effect/platform-browser";
import { pipeline } from "@xenova/transformers";
import {
  decodeWorkerRequest,
  encodeTranscribeResponse,
  encodePreloadResponse,
  PreloadRequest,
  PreloadResponse,
  TranscribeRequest,
  TranscribeResponse,
  type WorkerRequest
} from "./WorkerClient";
import { TranscriptionFailed } from "../errors";

type TranscriberOutput = { text: string } | Array<{ text: string }>;
let transcriber: ((audio: Float32Array) => Promise<TranscriberOutput>) | null = null;

const ensureTranscriber = () =>
  Effect.tryPromise({
    try: async () => {
      if (!transcriber) {
        const asrPipeline = await pipeline("automatic-speech-recognition", "Xenova/whisper-base");
        transcriber = async (audio) =>
          asrPipeline(audio, { language: "spanish", task: "transcribe" });
      }
    },
    catch: (cause) => new TranscriptionFailed({ reason: String(cause) })
  });

/**
 * Handle transcription request.
 */
const transcribe = Effect.fn(function* (request: TranscribeRequest) {
  yield* ensureTranscriber();
  const result = yield* Effect.tryPromise({
    try: () => transcriber!(request.audio),
    catch: (cause) => new TranscriptionFailed({ reason: String(cause) })
  });
  const transcript = Array.isArray(result) ? result[0]?.text ?? "" : result.text;
  return new TranscribeResponse({ type: "result", transcript });
});

/**
 * Handle preload request - loads model without transcribing.
 * Returns status indicating whether model was newly loaded or already cached.
 *
 * @see ensayo_quest-m3q: Add Whisper model preloading for better UX
 */
const preload = Effect.fn(function* (_request: PreloadRequest) {
  const wasAlreadyLoaded = transcriber !== null;
  yield* ensureTranscriber();
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
