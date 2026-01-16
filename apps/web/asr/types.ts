import * as Schema from "effect/Schema";

const Float32ArraySchema: Schema.Schema<Float32Array> = Schema.declare(
  (input): input is Float32Array => input instanceof Float32Array,
  {
    identifier: "Float32Array",
    title: "Float32Array"
  }
);

export class ASRConfig extends Schema.Class<ASRConfig>("ASRConfig")({
  model: Schema.Literal("whisper-base"),
  language: Schema.Literal("es"),
  sampleRate: Schema.Number
}) {}

export class ASRResult extends Schema.Class<ASRResult>("ASRResult")({
  transcript: Schema.String,
  durationMs: Schema.Number,
  chunkCount: Schema.Number,
  sampleRate: Schema.Number,
  audio: Float32ArraySchema
}) {}

export const defaultConfig = new ASRConfig({
  model: "whisper-base",
  language: "es",
  sampleRate: 16000
});

export const decodeAsrConfig = Schema.decodeUnknownSync(ASRConfig);
export const encodeAsrConfig = Schema.encodeSync(ASRConfig);
export const decodeAsrResult = Schema.decodeUnknownSync(ASRResult);
export const encodeAsrResult = Schema.encodeSync(ASRResult);
