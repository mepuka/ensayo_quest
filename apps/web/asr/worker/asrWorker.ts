import { Effect } from "effect";
import { WorkerRunner } from "@effect/platform";
import { BrowserWorkerRunner } from "@effect/platform-browser";
import { pipeline } from "@xenova/transformers";
import {
  decodeTranscribeRequest,
  encodeTranscribeResponse,
  TranscribeRequest,
  TranscribeResponse
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

const transcribe = Effect.fn(function* (request: TranscribeRequest) {
  yield* ensureTranscriber();
  const result = yield* Effect.tryPromise({
    try: () => transcriber!(request.audio),
    catch: (cause) => new TranscriptionFailed({ reason: String(cause) })
  });
  const transcript = Array.isArray(result) ? result[0]?.text ?? "" : result.text;
  return new TranscribeResponse({ type: "result", transcript });
});

const runnerLayer = WorkerRunner.layer(transcribe, {
  decode: (message) => Effect.succeed(decodeTranscribeRequest(message)),
  encodeOutput: (_request, output) => Effect.succeed(encodeTranscribeResponse(output)),
  encodeError: (_request, error) => Effect.succeed(error)
});

Effect.runPromise(WorkerRunner.launch(runnerLayer).pipe(Effect.provide(BrowserWorkerRunner.layer)));
