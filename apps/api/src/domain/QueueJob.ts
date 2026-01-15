import * as Schema from "effect/Schema";

export class QueueJob extends Schema.Class<QueueJob>("QueueJob")({
  roomId: Schema.String,
  turnId: Schema.String
}) {}
