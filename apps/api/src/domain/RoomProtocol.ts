import * as Schema from "effect/Schema";
import * as MsgPack from "@effect/platform/MsgPack";

export class TurnEvaluation extends Schema.Class<TurnEvaluation>("TurnEvaluation")({
  turnId: Schema.String,
  scores: Schema.Struct({
    fluency: Schema.Number,
    vocab: Schema.Number,
    naturalness: Schema.Number
  }),
  overallScore: Schema.Number,
  feedback: Schema.Array(Schema.String),
  nextPrompt: Schema.String,
  modelVersion: Schema.String,
  confidence: Schema.Number
}) {}

export class RoomHistoryEntry extends Schema.Class<RoomHistoryEntry>("RoomHistoryEntry")({
  turnId: Schema.String,
  role: Schema.Literal("user", "npc"),
  text: Schema.String,
  score: Schema.optional(TurnEvaluation)
}) {}

export class RoomSnapshot extends Schema.Class<RoomSnapshot>("RoomSnapshot")({
  type: Schema.Literal("RoomSnapshot"),
  roomId: Schema.String,
  scenarioId: Schema.String,
  status: Schema.Literal("playing", "completed"),
  currentTurnIndex: Schema.Number,
  objectivesCompleted: Schema.Number,
  history: Schema.Array(RoomHistoryEntry)
}) {}

export class TurnAccepted extends Schema.Class<TurnAccepted>("TurnAccepted")({
  type: Schema.Literal("TurnAccepted"),
  turnId: Schema.String
}) {}

export class ScoreUpdated extends Schema.Class<ScoreUpdated>("ScoreUpdated")({
  type: Schema.Literal("ScoreUpdated"),
  turnId: Schema.String,
  evaluation: TurnEvaluation
}) {}

export class RoomCompleted extends Schema.Class<RoomCompleted>("RoomCompleted")({
  type: Schema.Literal("RoomCompleted"),
  summary: Schema.String
}) {}

export class RoomError extends Schema.Class<RoomError>("RoomError")({
  type: Schema.Literal("Error"),
  code: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean
}) {}

export const RoomEventSchema = Schema.Union(
  RoomSnapshot,
  TurnAccepted,
  ScoreUpdated,
  RoomCompleted,
  RoomError
);

export type RoomEvent = Schema.Schema.Type<typeof RoomEventSchema>;

export class RoomEventEnvelope extends Schema.Class<RoomEventEnvelope>("RoomEventEnvelope")({
  roomId: Schema.String,
  event: RoomEventSchema,
  stateJson: Schema.optional(Schema.String)
}) {}

export const decodeRoomEvent = Schema.decodeUnknownSync(RoomEventSchema);
export const encodeRoomEvent = Schema.encodeSync(RoomEventSchema);

export const RoomEventMsgPack = MsgPack.schema(RoomEventSchema);
export const decodeRoomEventMsgPack = Schema.decodeSync(RoomEventMsgPack);
export const encodeRoomEventMsgPack = Schema.encodeSync(RoomEventMsgPack);

export const RoomEventEnvelopeMsgPack = MsgPack.schema(RoomEventEnvelope);
export const decodeRoomEventEnvelopeMsgPack = Schema.decodeSync(RoomEventEnvelopeMsgPack);
export const encodeRoomEventEnvelopeMsgPack = Schema.encodeSync(RoomEventEnvelopeMsgPack);
