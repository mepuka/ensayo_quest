import * as Schema from "effect/Schema";
import * as MsgPack from "@effect/platform/MsgPack";

// =============================================================================
// Shared Types
// =============================================================================

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

// =============================================================================
// Client-Side Event Types (with type field for union discrimination)
// =============================================================================

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

// New event types matching server's EventGroup
export class PlayerJoined extends Schema.Class<PlayerJoined>("PlayerJoined")({
  type: Schema.Literal("PlayerJoined"),
  roomId: Schema.String,
  playerId: Schema.String,
  sessionId: Schema.String,
  timestamp: Schema.Number
}) {}

export class PlayerDisconnected extends Schema.Class<PlayerDisconnected>("PlayerDisconnected")({
  type: Schema.Literal("PlayerDisconnected"),
  roomId: Schema.String,
  playerId: Schema.String,
  sessionId: Schema.String,
  timestamp: Schema.Number
}) {}

export class NpcTurnGenerated extends Schema.Class<NpcTurnGenerated>("NpcTurnGenerated")({
  type: Schema.Literal("NpcTurnGenerated"),
  roomId: Schema.String,
  turnId: Schema.String,
  npcId: Schema.String,
  content: Schema.String,
  stepIndex: Schema.Number,
  timestamp: Schema.Number
}) {}

export class TurnAdvanced extends Schema.Class<TurnAdvanced>("TurnAdvanced")({
  type: Schema.Literal("TurnAdvanced"),
  roomId: Schema.String,
  fromStepIndex: Schema.Number,
  toStepIndex: Schema.Number,
  nextParticipantType: Schema.Literal("Player", "NPC"),
  nextParticipantId: Schema.String
}) {}

export const RoomEventSchema = Schema.Union(
  RoomSnapshot,
  TurnAccepted,
  ScoreUpdated,
  RoomCompleted,
  RoomError,
  PlayerJoined,
  PlayerDisconnected,
  NpcTurnGenerated,
  TurnAdvanced
);

export type RoomEvent = Schema.Schema.Type<typeof RoomEventSchema>;

// =============================================================================
// Server Payload Schemas (for decoding journal entries)
// Server stores events without the type field - it's in entry.event
// =============================================================================

const TurnAcceptedPayloadSchema = Schema.Struct({
  roomId: Schema.String,
  turnId: Schema.String,
  playerId: Schema.String,
  transcript: Schema.String,
  timestamp: Schema.Number
});

const ScoreUpdatedPayloadSchema = Schema.Struct({
  roomId: Schema.String,
  turnId: Schema.String,
  scores: Schema.Struct({
    fluency: Schema.Number,
    vocab: Schema.Number,
    naturalness: Schema.Number
  }),
  overallScore: Schema.Number,
  feedback: Schema.Array(Schema.String),
  nextPrompt: Schema.String
});

const RoomCompletedPayloadSchema = Schema.Struct({
  roomId: Schema.String,
  summary: Schema.String,
  timestamp: Schema.Number
});

const RoomErrorPayloadSchema = Schema.Struct({
  roomId: Schema.String,
  code: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean,
  timestamp: Schema.Number
});

const PlayerJoinedPayloadSchema = Schema.Struct({
  roomId: Schema.String,
  playerId: Schema.String,
  sessionId: Schema.String,
  timestamp: Schema.Number
});

const PlayerDisconnectedPayloadSchema = Schema.Struct({
  roomId: Schema.String,
  playerId: Schema.String,
  sessionId: Schema.String,
  timestamp: Schema.Number
});

const NpcTurnGeneratedPayloadSchema = Schema.Struct({
  roomId: Schema.String,
  turnId: Schema.String,
  npcId: Schema.String,
  content: Schema.String,
  stepIndex: Schema.Number,
  timestamp: Schema.Number
});

const TurnAdvancedPayloadSchema = Schema.Struct({
  roomId: Schema.String,
  fromStepIndex: Schema.Number,
  toStepIndex: Schema.Number,
  nextParticipantType: Schema.Literal("Player", "NPC"),
  nextParticipantId: Schema.String
});

// MsgPack decoders for each payload type
const payloadDecoders = {
  TurnAccepted: Schema.decodeSync(MsgPack.schema(TurnAcceptedPayloadSchema)),
  ScoreUpdated: Schema.decodeSync(MsgPack.schema(ScoreUpdatedPayloadSchema)),
  RoomCompleted: Schema.decodeSync(MsgPack.schema(RoomCompletedPayloadSchema)),
  RoomError: Schema.decodeSync(MsgPack.schema(RoomErrorPayloadSchema)),
  PlayerJoined: Schema.decodeSync(MsgPack.schema(PlayerJoinedPayloadSchema)),
  PlayerDisconnected: Schema.decodeSync(MsgPack.schema(PlayerDisconnectedPayloadSchema)),
  NpcTurnGenerated: Schema.decodeSync(MsgPack.schema(NpcTurnGeneratedPayloadSchema)),
  TurnAdvanced: Schema.decodeSync(MsgPack.schema(TurnAdvancedPayloadSchema))
} as const;

// MsgPack encoders for each payload type (for testing)
export const payloadEncoders = {
  TurnAccepted: Schema.encodeSync(MsgPack.schema(TurnAcceptedPayloadSchema)),
  ScoreUpdated: Schema.encodeSync(MsgPack.schema(ScoreUpdatedPayloadSchema)),
  RoomCompleted: Schema.encodeSync(MsgPack.schema(RoomCompletedPayloadSchema)),
  RoomError: Schema.encodeSync(MsgPack.schema(RoomErrorPayloadSchema)),
  PlayerJoined: Schema.encodeSync(MsgPack.schema(PlayerJoinedPayloadSchema)),
  PlayerDisconnected: Schema.encodeSync(MsgPack.schema(PlayerDisconnectedPayloadSchema)),
  NpcTurnGenerated: Schema.encodeSync(MsgPack.schema(NpcTurnGeneratedPayloadSchema)),
  TurnAdvanced: Schema.encodeSync(MsgPack.schema(TurnAdvancedPayloadSchema))
} as const;

/**
 * Decode a journal entry into a RoomEvent.
 *
 * Journal entries store the event type in `entry.event` and the payload
 * (without type field) in `entry.payload`. This function reconstructs
 * the full RoomEvent with the type field for union discrimination.
 */
export const decodeJournalEntry = (entry: { event: string; payload: Uint8Array }): RoomEvent => {
  const eventType = entry.event;

  switch (eventType) {
    case "TurnAccepted": {
      const payload = payloadDecoders.TurnAccepted(entry.payload);
      return { type: "TurnAccepted", turnId: payload.turnId };
    }
    case "ScoreUpdated": {
      const payload = payloadDecoders.ScoreUpdated(entry.payload);
      return {
        type: "ScoreUpdated",
        turnId: payload.turnId,
        evaluation: {
          turnId: payload.turnId,
          scores: payload.scores,
          overallScore: payload.overallScore,
          feedback: payload.feedback,
          nextPrompt: payload.nextPrompt,
          modelVersion: "unknown",
          confidence: 1.0
        }
      };
    }
    case "RoomCompleted": {
      const payload = payloadDecoders.RoomCompleted(entry.payload);
      return { type: "RoomCompleted", summary: payload.summary };
    }
    case "RoomError": {
      const payload = payloadDecoders.RoomError(entry.payload);
      return {
        type: "Error",
        code: payload.code,
        message: payload.message,
        retryable: payload.retryable
      };
    }
    case "PlayerJoined": {
      const payload = payloadDecoders.PlayerJoined(entry.payload);
      return {
        type: "PlayerJoined",
        roomId: payload.roomId,
        playerId: payload.playerId,
        sessionId: payload.sessionId,
        timestamp: payload.timestamp
      };
    }
    case "PlayerDisconnected": {
      const payload = payloadDecoders.PlayerDisconnected(entry.payload);
      return {
        type: "PlayerDisconnected",
        roomId: payload.roomId,
        playerId: payload.playerId,
        sessionId: payload.sessionId,
        timestamp: payload.timestamp
      };
    }
    case "NpcTurnGenerated": {
      const payload = payloadDecoders.NpcTurnGenerated(entry.payload);
      return {
        type: "NpcTurnGenerated",
        roomId: payload.roomId,
        turnId: payload.turnId,
        npcId: payload.npcId,
        content: payload.content,
        stepIndex: payload.stepIndex,
        timestamp: payload.timestamp
      };
    }
    case "TurnAdvanced": {
      const payload = payloadDecoders.TurnAdvanced(entry.payload);
      return {
        type: "TurnAdvanced",
        roomId: payload.roomId,
        fromStepIndex: payload.fromStepIndex,
        toStepIndex: payload.toStepIndex,
        nextParticipantType: payload.nextParticipantType,
        nextParticipantId: payload.nextParticipantId
      };
    }
    default:
      // Unknown event type - log and return a generic error
      console.warn(`Unknown event type: ${eventType}`);
      return {
        type: "Error",
        code: "UNKNOWN_EVENT",
        message: `Unknown event type: ${eventType}`,
        retryable: false
      };
  }
};

// =============================================================================
// Legacy Envelope Protocol (for HTTP POST)
// =============================================================================

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
