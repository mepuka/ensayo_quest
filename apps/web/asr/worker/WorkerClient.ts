import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { Worker } from "@effect/platform";
import { TranscriptionFailed } from "../errors";

const Float32ArraySchema: Schema.Schema<Float32Array> = Schema.declare(
  (input): input is Float32Array => input instanceof Float32Array,
  {
    identifier: "Float32Array",
    title: "Float32Array"
  }
);

export class TranscribeRequest extends Schema.Class<TranscribeRequest>("TranscribeRequest")({
  type: Schema.Literal("transcribe"),
  audio: Float32ArraySchema,
  sampleRate: Schema.Number
}) {}

export class TranscribeResponse extends Schema.Class<TranscribeResponse>("TranscribeResponse")({
  type: Schema.Literal("result"),
  transcript: Schema.String
}) {}

/**
 * Request to preload the Whisper model.
 * Sent during app initialization for better UX.
 *
 * @see ensayo_quest-m3q: Add Whisper model preloading for better UX
 */
export class PreloadRequest extends Schema.Class<PreloadRequest>("PreloadRequest")({
  type: Schema.Literal("preload")
}) {}

/**
 * Response after model preload completes.
 * Status indicates whether model was already loaded or newly loaded.
 */
export class PreloadResponse extends Schema.Class<PreloadResponse>("PreloadResponse")({
  type: Schema.Literal("preload_complete"),
  status: Schema.Union(Schema.Literal("loaded"), Schema.Literal("already_loaded"))
}) {}

export type WorkerReady = {
  type: "ready";
};

export type WorkerError = {
  type: "error";
  reason: string;
};

export type WorkerMessage = TranscribeResponse | PreloadResponse | WorkerReady | WorkerError;

/**
 * Union type for all worker requests.
 */
export type WorkerRequest = TranscribeRequest | PreloadRequest;

export const decodeTranscribeRequest = Schema.decodeUnknownSync(TranscribeRequest);
export const encodeTranscribeRequest = Schema.encodeSync(TranscribeRequest);
export const decodeTranscribeResponse = Schema.decodeUnknownSync(TranscribeResponse);
export const encodeTranscribeResponse = Schema.encodeSync(TranscribeResponse);

export const decodePreloadRequest = Schema.decodeUnknownSync(PreloadRequest);
export const encodePreloadRequest = Schema.encodeSync(PreloadRequest);
export const decodePreloadResponse = Schema.decodeUnknownSync(PreloadResponse);
export const encodePreloadResponse = Schema.encodeSync(PreloadResponse);

/**
 * Decode any worker request based on type field.
 */
export const decodeWorkerRequest = (input: unknown): WorkerRequest => {
  const obj = input as { type?: string };
  if (obj.type === "preload") {
    return decodePreloadRequest(input);
  }
  return decodeTranscribeRequest(input);
};

export const buildTranscribeRequest = (
  audio: Float32Array,
  sampleRate: number
): TranscribeRequest =>
  new TranscribeRequest({
    type: "transcribe",
    audio,
    sampleRate
  });

export type AsrWorker = Worker.Worker<WorkerRequest, TranscribeResponse | PreloadResponse, TranscriptionFailed>;

export const createWorkerClient = (worker: AsrWorker) => {
  const transcribe = (audio: Float32Array, sampleRate: number) =>
    worker.executeEffect(buildTranscribeRequest(audio, sampleRate)) as Effect.Effect<
      TranscribeResponse,
      TranscriptionFailed
    >;

  /**
   * Preload the Whisper model in the worker.
   * Returns immediately if model is already loaded.
   *
   * @see ensayo_quest-m3q: Add Whisper model preloading for better UX
   */
  const preload = () =>
    worker.executeEffect(new PreloadRequest({ type: "preload" })) as Effect.Effect<
      PreloadResponse,
      TranscriptionFailed
    >;

  return { transcribe, preload };
};
