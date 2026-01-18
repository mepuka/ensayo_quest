/**
 * HTTP Protocol Schemas
 *
 * Single source of truth for HTTP request/response schemas used by both
 * frontend and backend. Eliminates schema drift between client and server.
 *
 * @see docs/ARCHITECTURE.md - Invariant #2: All commands are idempotent via requestId
 */
import * as Schema from "effect/Schema";

// =============================================================================
// Request Schemas
// =============================================================================

export class CreateRoomRequest extends Schema.Class<CreateRoomRequest>("CreateRoomRequest")({
  /** Client-generated unique ID for idempotency. Required for retry safety. */
  requestId: Schema.String,
  topic: Schema.String,
  level: Schema.String,
  mode: Schema.String
}) {}

export class HttpTurnSubmission extends Schema.Class<HttpTurnSubmission>("HttpTurnSubmission")({
  roomId: Schema.String,
  turnId: Schema.optional(Schema.String),
  /** Client-generated unique ID for idempotency. Required for retry safety. */
  requestId: Schema.String,
  transcript: Schema.String,
  language: Schema.String,
  clientTimestamp: Schema.Number,
  audioFeatures: Schema.Struct({
    durationMs: Schema.Number,
    pauseCount: Schema.Number,
    speakingRateWpm: Schema.Number
  }),
  asrSource: Schema.optional(Schema.String)
}) {}

// =============================================================================
// Response Schemas
// =============================================================================

export class CreateRoomResponse extends Schema.Class<CreateRoomResponse>("CreateRoomResponse")({
  roomId: Schema.String,
  /** WebSocket URL for room connection. Always provided by backend. */
  wsUrl: Schema.String,
  seedPrompt: Schema.String
}) {}

export class RoomWsResponse extends Schema.Class<RoomWsResponse>("RoomWsResponse")({
  roomId: Schema.String,
  /** WebSocket URL for room connection. Always provided by backend. */
  wsUrl: Schema.String
}) {}

export class SubmitTurnResponse extends Schema.Class<SubmitTurnResponse>("SubmitTurnResponse")({
  turnId: Schema.String,
  status: Schema.String
}) {}

export class TurnAudioResponse extends Schema.Class<TurnAudioResponse>("TurnAudioResponse")({
  audioKey: Schema.String,
  /** Upload status: "uploaded" or "already_uploaded" (idempotent) */
  status: Schema.String
}) {}

export class HttpErrorResponse extends Schema.Class<HttpErrorResponse>("HttpErrorResponse")({
  code: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean
}) {}

// =============================================================================
// Encoders/Decoders
// =============================================================================

export const decodeCreateRoomRequest = Schema.decodeUnknownSync(CreateRoomRequest);
export const encodeCreateRoomRequest = Schema.encodeSync(CreateRoomRequest);
export const decodeCreateRoomResponse = Schema.decodeUnknownSync(CreateRoomResponse);
export const encodeCreateRoomResponse = Schema.encodeSync(CreateRoomResponse);
export const decodeRoomWsResponse = Schema.decodeUnknownSync(RoomWsResponse);
export const encodeRoomWsResponse = Schema.encodeSync(RoomWsResponse);
export const decodeSubmitTurnResponse = Schema.decodeUnknownSync(SubmitTurnResponse);
export const encodeSubmitTurnResponse = Schema.encodeSync(SubmitTurnResponse);
export const decodeTurnAudioResponse = Schema.decodeUnknownSync(TurnAudioResponse);
export const encodeTurnAudioResponse = Schema.encodeSync(TurnAudioResponse);
export const decodeHttpErrorResponse = Schema.decodeUnknownSync(HttpErrorResponse);
export const encodeHttpErrorResponse = Schema.encodeSync(HttpErrorResponse);
export const decodeHttpTurnSubmission = Schema.decodeUnknownSync(HttpTurnSubmission);
export const encodeHttpTurnSubmission = Schema.encodeSync(HttpTurnSubmission);

// =============================================================================
// Type Exports (for TypeScript consumers)
// =============================================================================

export type CreateRoomInput = Schema.Schema.Type<typeof CreateRoomRequest>;
export type SubmitTurnInput = Schema.Schema.Type<typeof HttpTurnSubmission>;
export type CreateRoomResult = Schema.Schema.Type<typeof CreateRoomResponse>;
export type RoomWsResult = Schema.Schema.Type<typeof RoomWsResponse>;
export type SubmitTurnResult = Schema.Schema.Type<typeof SubmitTurnResponse>;
export type UploadAudioResult = Schema.Schema.Type<typeof TurnAudioResponse>;
