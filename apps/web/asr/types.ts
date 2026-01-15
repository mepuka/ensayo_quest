import * as Schema from "effect/Schema";

export class ASRConfig extends Schema.Class<ASRConfig>("ASRConfig")({
  model: Schema.Literal("whisper-base"),
  language: Schema.Literal("es"),
  sampleRate: Schema.Number
}) {}

export class ASRResult extends Schema.Class<ASRResult>("ASRResult")({
  transcript: Schema.String,
  durationMs: Schema.Number,
  chunkCount: Schema.Number
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
