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

export type WorkerReady = {
  type: "ready";
};

export type WorkerError = {
  type: "error";
  reason: string;
};

export type WorkerMessage = TranscribeResponse | WorkerReady | WorkerError;

export const decodeTranscribeRequest = Schema.decodeUnknownSync(TranscribeRequest);
export const encodeTranscribeRequest = Schema.encodeSync(TranscribeRequest);
export const decodeTranscribeResponse = Schema.decodeUnknownSync(TranscribeResponse);
export const encodeTranscribeResponse = Schema.encodeSync(TranscribeResponse);

export const buildTranscribeRequest = (
  audio: Float32Array,
  sampleRate: number
): TranscribeRequest =>
  new TranscribeRequest({
    type: "transcribe",
    audio,
    sampleRate
  });

export type AsrWorker = Worker.Worker<TranscribeRequest, TranscribeResponse, TranscriptionFailed>;

export const createWorkerClient = (worker: AsrWorker) => {
  const transcribe = (audio: Float32Array, sampleRate: number) =>
    worker.executeEffect(buildTranscribeRequest(audio, sampleRate));

  return { transcribe };
};
