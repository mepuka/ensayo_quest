import * as Schema from "effect/Schema";

export class MicDenied extends Schema.TaggedError<MicDenied>()("MicDenied", {}) {}

export class WorkletInitFailed extends Schema.TaggedError<WorkletInitFailed>()(
  "WorkletInitFailed",
  { reason: Schema.String }
) {}

export class TranscriptionFailed extends Schema.TaggedError<TranscriptionFailed>()(
  "TranscriptionFailed",
  { reason: Schema.String }
) {}
