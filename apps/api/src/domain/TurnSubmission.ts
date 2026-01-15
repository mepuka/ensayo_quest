import * as Schema from "effect/Schema";

export class TurnSubmission extends Schema.Class<TurnSubmission>("TurnSubmission")({
  roomId: Schema.String,
  turnId: Schema.String,
  templateId: Schema.String,
  turnIndex: Schema.Number,
  speakerUserId: Schema.String,
  transcript: Schema.String,
  audioStats: Schema.Struct({
    totalMs: Schema.Number,
    speechMs: Schema.Number,
    silenceMs: Schema.Number,
    segments: Schema.Array(
      Schema.Struct({ startMs: Schema.Number, endMs: Schema.Number })
    )
  })
}) {}

export const decodeTurnSubmission = Schema.decodeUnknownSync(TurnSubmission);
export const encodeTurnSubmission = Schema.encodeSync(TurnSubmission);
