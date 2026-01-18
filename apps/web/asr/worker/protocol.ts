/**
 * ASR Worker Protocol - TaggedRequest definitions for serialized worker communication.
 *
 * This module defines the protocol for ASR worker requests and responses using Effect's
 * TaggedRequest pattern. These schemas enable automatic encode/decode in WorkerRunner.layerSerialized.
 *
 * @module
 */
import * as Schema from "effect/Schema";
import { Transferable } from "@effect/platform";
import { TranscriptionFailed } from "../errors";

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

/**
 * Schema for Float32Array with Transferable support.
 * When encoding, the underlying ArrayBuffer is registered for transfer.
 */
const Float32ArrayFromSelf: Schema.Schema<Float32Array> = Schema.declare(
  (input): input is Float32Array => input instanceof Float32Array,
  {
    identifier: "Float32ArrayFromSelf",
    title: "Float32Array"
  }
);

/**
 * Float32Array schema that collects the buffer as Transferable during encoding.
 * This allows zero-copy transfer of audio data between main thread and worker.
 */
export const TransferableFloat32Array = Transferable.schema(
  Float32ArrayFromSelf,
  (arr) => [arr.buffer]
);

/**
 * ASR configuration schema for optional model/language settings.
 */
export class ASRConfigPayload extends Schema.Class<ASRConfigPayload>("ASRConfigPayload")({
  model: Schema.optional(Schema.Literal("whisper-base")),
  language: Schema.optional(Schema.Literal("es")),
  sampleRate: Schema.optional(Schema.Number)
}) {}

// -----------------------------------------------------------------------------
// Progress Events (for streaming preload status)
// -----------------------------------------------------------------------------

/**
 * Progress status during model preloading.
 * Maps to HuggingFace Transformers progress_callback statuses.
 */
export const PreloadStatus = Schema.Union(
  Schema.Literal("initiate"),
  Schema.Literal("download"),
  Schema.Literal("progress"),
  Schema.Literal("done"),
  Schema.Literal("ready")
);

/**
 * Progress event emitted during model preloading.
 * Streamed to client as model files are downloaded.
 */
export class PreloadProgress extends Schema.Class<PreloadProgress>("PreloadProgress")({
  _tag: Schema.Literal("PreloadProgress"),
  status: PreloadStatus,
  file: Schema.optional(Schema.String),
  progress: Schema.optional(Schema.Number),
  loaded: Schema.optional(Schema.Number),
  total: Schema.optional(Schema.Number)
}) {}

/**
 * Final event when preload completes successfully.
 */
export class PreloadComplete extends Schema.Class<PreloadComplete>("PreloadComplete")({
  _tag: Schema.Literal("PreloadComplete"),
  status: Schema.Union(Schema.Literal("loaded"), Schema.Literal("already_loaded"))
}) {}

// -----------------------------------------------------------------------------
// Transcription Result
// -----------------------------------------------------------------------------

/**
 * Successful transcription result.
 */
export class TranscribeResult extends Schema.Class<TranscribeResult>("TranscribeResult")({
  _tag: Schema.Literal("TranscribeResult"),
  transcript: Schema.String
}) {}

// -----------------------------------------------------------------------------
// Preload Stream Event Union
// -----------------------------------------------------------------------------

/**
 * Union of all events that can be emitted during preload.
 * The stream emits PreloadProgress events during download, ending with PreloadComplete.
 */
export const PreloadEvent = Schema.Union(PreloadProgress, PreloadComplete);
export type PreloadEvent = Schema.Schema.Type<typeof PreloadEvent>;

// -----------------------------------------------------------------------------
// TaggedRequest Classes
// -----------------------------------------------------------------------------

/**
 * Request to preload the Whisper ASR model.
 *
 * The handler returns a Stream of PreloadEvent:
 * - Multiple PreloadProgress events during model download
 * - Final PreloadComplete event when loading finishes
 */
export class Preload extends Schema.TaggedRequest<Preload>()("Preload", {
  failure: TranscriptionFailed,
  success: PreloadEvent,
  payload: {
    requestId: Schema.String,
    config: Schema.optional(ASRConfigPayload)
  }
}) {}

/**
 * Request to transcribe audio data.
 *
 * Audio is transferred as a Float32Array with zero-copy via Transferable.
 * Success returns TranscribeResult with the transcribed text.
 */
export class Transcribe extends Schema.TaggedRequest<Transcribe>()("Transcribe", {
  failure: TranscriptionFailed,
  success: TranscribeResult,
  payload: {
    requestId: Schema.String,
    audio: TransferableFloat32Array,
    sampleRate: Schema.Number,
    config: Schema.optional(ASRConfigPayload)
  }
}) {}

// -----------------------------------------------------------------------------
// Union Schema for Worker
// -----------------------------------------------------------------------------

/**
 * Union of all ASR worker requests.
 * Used with WorkerRunner.layerSerialized for automatic dispatch.
 */
export const ASRWorkerRequest = Schema.Union(Preload, Transcribe);
export type ASRWorkerRequest = Schema.Schema.Type<typeof ASRWorkerRequest>;

// -----------------------------------------------------------------------------
// Backward Compatibility Exports
// -----------------------------------------------------------------------------

/**
 * Legacy type aliases for backward compatibility with existing code.
 * These map to the new TaggedRequest types.
 *
 * @deprecated Use Preload, Transcribe, TranscribeResult, PreloadComplete directly.
 */
export type PreloadRequest = Preload;
export type TranscribeRequest = Transcribe;
export type PreloadResponse = PreloadComplete;
export type TranscribeResponse = TranscribeResult;
