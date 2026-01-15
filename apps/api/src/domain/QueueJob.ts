import * as Schema from "effect/Schema";

export class QueueJob extends Schema.Class<QueueJob>("QueueJob")({
  roomId: Schema.String,
  turnId: Schema.String,
  overall: Schema.Number,
  detailJson: Schema.String,
  status: Schema.Literal("partial", "final")
}) {}

export const decodeQueueJob = Schema.decodeUnknownSync(QueueJob);
export const encodeQueueJob = Schema.encodeSync(QueueJob);
