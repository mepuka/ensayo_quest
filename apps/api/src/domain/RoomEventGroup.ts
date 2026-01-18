/**
 * RoomEventGroup - Event definitions for room state machine
 *
 * This defines all events that can occur in a room. Events are the source of truth;
 * room state is derived by reducing these events.
 *
 * @see docs/ARCHITECTURE.md - Invariant #1: EventLog is the single source of truth
 */
import * as Schema from "effect/Schema";
import { EventGroup } from "@effect/experimental";

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error that can occur when handling room events.
 * Primarily wraps SQL errors during state persistence.
 */
export class RoomEventHandlerError extends Schema.TaggedError<RoomEventHandlerError>()(
  "RoomEventHandlerError",
  {
    operation: Schema.String,
    roomId: Schema.String,
    cause: Schema.Unknown
  }
) {}

// =============================================================================
// Event Payloads
// =============================================================================

export class TurnAcceptedPayload extends Schema.Class<TurnAcceptedPayload>("TurnAcceptedPayload")({
  roomId: Schema.String,
  turnId: Schema.String,
  playerId: Schema.String,
  transcript: Schema.String,
  timestamp: Schema.Number
}) {}

export class ScoreUpdatedPayload extends Schema.Class<ScoreUpdatedPayload>("ScoreUpdatedPayload")({
  roomId: Schema.String,
  turnId: Schema.String,
  status: Schema.Literal("partial", "final"),
  scoreAttemptId: Schema.String,
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

export class NpcTurnGeneratedPayload extends Schema.Class<NpcTurnGeneratedPayload>("NpcTurnGeneratedPayload")({
  roomId: Schema.String,
  turnId: Schema.String,
  npcId: Schema.String,
  content: Schema.String,
  stepIndex: Schema.Number,
  timestamp: Schema.Number
}) {}

export class TurnAdvancedPayload extends Schema.Class<TurnAdvancedPayload>("TurnAdvancedPayload")({
  roomId: Schema.String,
  fromStepIndex: Schema.Number,
  toStepIndex: Schema.Number,
  nextParticipantType: Schema.Literal("Player", "NPC"),
  nextParticipantId: Schema.String
}) {}

export class PlayerJoinedPayload extends Schema.Class<PlayerJoinedPayload>("PlayerJoinedPayload")({
  roomId: Schema.String,
  playerId: Schema.String,
  sessionId: Schema.String,
  timestamp: Schema.Number
}) {}

export class PlayerDisconnectedPayload extends Schema.Class<PlayerDisconnectedPayload>("PlayerDisconnectedPayload")({
  roomId: Schema.String,
  playerId: Schema.String,
  sessionId: Schema.String,
  timestamp: Schema.Number
}) {}

export class RoomCompletedPayload extends Schema.Class<RoomCompletedPayload>("RoomCompletedPayload")({
  roomId: Schema.String,
  summary: Schema.String,
  timestamp: Schema.Number
}) {}

export class RoomErrorPayload extends Schema.Class<RoomErrorPayload>("RoomErrorPayload")({
  roomId: Schema.String,
  code: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean,
  timestamp: Schema.Number
}) {}

/**
 * RoomInitialized - Emitted when a room is created.
 *
 * Persists room metadata (seedPrompt, topic, level) to EventLog.
 * This data survives page refresh and is the source of truth for room configuration.
 *
 * @see docs/ARCHITECTURE.md - Events section, Invariant #10
 */
export class RoomInitializedPayload extends Schema.Class<RoomInitializedPayload>("RoomInitializedPayload")({
  roomId: Schema.String,
  scenarioId: Schema.String,
  seedPrompt: Schema.String,
  topic: Schema.String,
  level: Schema.String,
  templateVersion: Schema.String,
  timestamp: Schema.Number
}) {}

/**
 * AudioUploaded - Emitted when audio for a turn has been uploaded to R2.
 *
 * This event gates the scoring pipeline - scoring can only begin after audio exists.
 * @see docs/ARCHITECTURE.md - Invariant #9: Scoring enqueue gated on AudioUploaded
 * @see docs/plans/2026-01-16-frontend-voice-stack-design.md - Section 5
 */
export class AudioUploadedPayload extends Schema.Class<AudioUploadedPayload>("AudioUploadedPayload")({
  roomId: Schema.String,
  turnId: Schema.String,
  audioKey: Schema.String,
  requestId: Schema.String, // Required for EventLog-level idempotency
  contentType: Schema.optional(Schema.String),
  fileSizeBytes: Schema.Number,
  durationMs: Schema.optional(Schema.Number),
  timestamp: Schema.Number
}) {}

// =============================================================================
// Event Group Definition
// =============================================================================

/**
 * RoomEventGroup defines all events that can occur in a room.
 *
 * Each event has:
 * - tag: unique event identifier
 * - primaryKey: function to extract the grouping key (roomId)
 * - payload: the event data schema
 * - success: what the handler returns on success
 * - error: what errors the handler can produce
 */
export const RoomEventGroup = EventGroup.empty
  .add({
    tag: "RoomInitialized",
    primaryKey: (payload: RoomInitializedPayload) => payload.roomId,
    payload: RoomInitializedPayload,
    success: Schema.Void,
    error: RoomEventHandlerError
  })
  .add({
    tag: "TurnAccepted",
    primaryKey: (payload: TurnAcceptedPayload) => payload.roomId,
    payload: TurnAcceptedPayload,
    success: Schema.Void,
    error: RoomEventHandlerError
  })
  .add({
    tag: "ScoreUpdated",
    primaryKey: (payload: ScoreUpdatedPayload) => payload.roomId,
    payload: ScoreUpdatedPayload,
    success: Schema.Void,
    error: RoomEventHandlerError
  })
  .add({
    tag: "NpcTurnGenerated",
    primaryKey: (payload: NpcTurnGeneratedPayload) => payload.roomId,
    payload: NpcTurnGeneratedPayload,
    success: Schema.Void,
    error: RoomEventHandlerError
  })
  .add({
    tag: "TurnAdvanced",
    primaryKey: (payload: TurnAdvancedPayload) => payload.roomId,
    payload: TurnAdvancedPayload,
    success: Schema.Void,
    error: RoomEventHandlerError
  })
  .add({
    tag: "PlayerJoined",
    primaryKey: (payload: PlayerJoinedPayload) => payload.roomId,
    payload: PlayerJoinedPayload,
    success: Schema.Void,
    error: RoomEventHandlerError
  })
  .add({
    tag: "PlayerDisconnected",
    primaryKey: (payload: PlayerDisconnectedPayload) => payload.roomId,
    payload: PlayerDisconnectedPayload,
    success: Schema.Void,
    error: RoomEventHandlerError
  })
  .add({
    tag: "RoomCompleted",
    primaryKey: (payload: RoomCompletedPayload) => payload.roomId,
    payload: RoomCompletedPayload,
    success: Schema.Void,
    error: RoomEventHandlerError
  })
  .add({
    tag: "RoomError",
    primaryKey: (payload: RoomErrorPayload) => payload.roomId,
    payload: RoomErrorPayload,
    success: Schema.Void,
    error: RoomEventHandlerError
  })
  .add({
    tag: "AudioUploaded",
    primaryKey: (payload: AudioUploadedPayload) => payload.roomId,
    payload: AudioUploadedPayload,
    success: Schema.Void,
    error: RoomEventHandlerError
  });

export type RoomEventGroup = typeof RoomEventGroup;
